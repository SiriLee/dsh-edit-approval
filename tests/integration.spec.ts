import { Context } from '@deepseek-ai/cordis'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { beforeEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { DEFAULT_BASH_APPROVAL, DEFAULT_EDIT_APPROVAL, type ApprovalConfig } from '../src/config.ts'

/**
 * Wiring-level integration over the SOURCE host half (no build step), so the
 * dispatch logic and the command surface get fast in-process feedback.
 *
 * `scripts/verify-host.mjs` is the authoritative host verification: it drives
 * the BUILT artifact against the real harness packages. This suite exists for
 * the inner loop and deliberately overlaps it a little.
 *
 * The settings double is anchored to the real service surface in both
 * directions. The previous version of the integration suite implemented only
 * `settings.register` — the one method DSH 0.1.7 removed — so the suite and the
 * plugin agreed with each other and with nothing real, and stayed green through
 * the very interface change that broke the plugin.
 */

const ENTRY_ID = 'dsh-edit-approval'
const REAL_SURFACE = new Set(Object.getOwnPropertyNames(SettingsForms.prototype))

/** One recorded write against the entry. */
interface WriteRecord {
  readonly op: 'update' | 'mutate'
  readonly ns: string
  readonly payload: unknown
}

interface Harness {
  readonly calls: { readonly policy: string }
  readonly commands: Array<{ name: string; handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> }>
  readonly writes: WriteRecord[]
  readonly presentations: Array<{ presentation: { auto?: boolean }; owner: unknown }>
  preExecute(name: string, args: Record<string, unknown>, withAgent?: boolean): Promise<{ kind: string; reason?: string }>
  setSwitch(field: 'editEnabled' | 'bashEnabled', value: boolean): void
}

/**
 * Mount the host plugin on a bare cordis Context with a live-config double.
 * @param options - ordinary fields to differ from the schema defaults; they are
 * fixed at mount because ordinary config is read as a plain value.
 */
async function mount(options: { readonly bashAllow?: readonly string[] } = {}): Promise<Harness> {
  const ctx = new Context()
  ctx.fiber.entry = { options: { id: ENTRY_ID } }

  // The entry document, plus the live references the plugin reads.
  const doc = {
    editEnabled: DEFAULT_EDIT_APPROVAL.enabled,
    bashEnabled: DEFAULT_BASH_APPROVAL.enabled,
    editTools: [...DEFAULT_EDIT_APPROVAL.tools],
    editMinDiffLines: DEFAULT_EDIT_APPROVAL.minDiffLines,
    editIncludeCreate: DEFAULT_EDIT_APPROVAL.includeCreate,
    editIncludeDelete: DEFAULT_EDIT_APPROVAL.includeDelete,
    bashTools: [...DEFAULT_BASH_APPROVAL.tools],
    bashAllow: [...(options.bashAllow ?? DEFAULT_BASH_APPROVAL.allow)],
  }
  const defaults: Record<string, unknown> = {
    editEnabled: DEFAULT_EDIT_APPROVAL.enabled,
    bashEnabled: DEFAULT_BASH_APPROVAL.enabled,
  }
  const apply = (path: readonly string[], value: unknown): void => {
    const leaf = path[path.length - 1] as string
    if (path.length === 1) (doc as Record<string, unknown>)[leaf] = value
    else (doc as unknown as Record<string, Record<string, unknown>>)[path[0]!]![leaf] = value
  }
  const config = {
    editEnabled: { get: () => doc.editEnabled },
    bashEnabled: { get: () => doc.bashEnabled },
    editTools: doc.editTools,
    editMinDiffLines: doc.editMinDiffLines,
    editIncludeCreate: doc.editIncludeCreate,
    editIncludeDelete: doc.editIncludeDelete,
    bashTools: doc.bashTools,
    bashAllow: doc.bashAllow,
  } as unknown as ApprovalConfig

  const calls = { policy: 'ask' }
  const commands: Harness['commands'] = []
  const writes: WriteRecord[] = []
  const presentations: Harness['presentations'] = []

  const settings = {
    configure: (presentation: { auto?: boolean }, owner: unknown) => {
      presentations.push({ presentation, owner })
      return () => {}
    },
    describe: () => [],
    update: async (ns: string, patch: Record<string, unknown>) => {
      writes.push({ op: 'update', ns, payload: { ...patch } })
      for (const [key, value] of Object.entries(patch)) apply([key], value)
    },
    mutate: async (ns: string, ops: readonly ({ op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] })[]) => {
      writes.push({ op: 'mutate', ns, payload: ops.map((op) => ({ ...op })) })
      for (const op of ops) {
        if (op.op === 'set') apply(op.path, op.value)
        else apply(op.path, defaults[op.path.join('.')])
      }
    },
  }

  // The double may only implement what the real service has.
  expect(Object.keys(settings).every((name) => REAL_SURFACE.has(name))).toBe(true)
  expect(REAL_SURFACE.has('register')).toBe(false)

  ctx.provide('fs', {
    resolve: async (path: string, opts?: { cwd?: string }) => ({
      targetKey: path,
      displayPath: path.startsWith('/') ? path : (opts?.cwd ? `${opts.cwd}/${path}` : path),
    }),
    stat: async (target: { displayPath: string }) => (target.displayPath === '/workspace/src/a.ts' ? { version: 'v', type: 'file' } : undefined),
    readText: async () => 'before\nunchanged',
  })
  ctx.provide('commands', { register: (definition: Harness['commands'][number]) => { commands.push(definition); return () => {} } })
  ctx.provide('tools', {})
  ctx.provide('approval', {
    overrideOf: () => (calls.policy === 'never' ? 'never' : undefined),
    config: { policy: 'ask' },
  })
  ctx.provide('settings', settings)

  plugin.apply(ctx, config)
  // The interception mounts through a nested `ctx.inject(['tools','fs'])` child.
  await new Promise((resolve) => setTimeout(resolve, 30))

  return {
    calls,
    commands,
    writes,
    presentations,
    setSwitch: (field, value) => { doc[field] = value },
    preExecute: (name, args, withAgent = true) => ctx.waterfall(
      ctx,
      'tools/pre-execute',
      {
        callId: `c-${name}`,
        name,
        arguments: args,
        agent: withAgent ? { id: 'a', session: { header: { cwd: '/workspace' } } } : undefined,
        signal: new AbortController().signal,
      },
      () => Promise.resolve({ kind: 'allow' }),
    ) as Promise<{ kind: string; reason?: string }>,
  }
}

let harness: Harness
beforeEach(async () => { harness = await mount() })

describe('host mounting', () => {
  it('registers both toggle commands', () => {
    expect(harness.commands.map((c) => c.name).sort()).toEqual(['approval-bash', 'approval-edit'])
  })

  it('declares its own config page for its own fiber', () => {
    // Owned by the plugin's fiber, not the inject child's: the policy is looked
    // up by `entry.fiber`, so the wrong owner would be silently inert.
    expect(harness.presentations).toHaveLength(1)
    expect(harness.presentations[0]!.presentation.auto).toBe(false)
    expect(harness.presentations[0]!.owner).toBeDefined()
  })
})

describe('edit interception', () => {
  it('asks for a tracked edit and carries the diff in the reason', async () => {
    const decision = await harness.preExecute('edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' })
    expect(decision.kind).toBe('ask')
    expect(decision.reason).toMatch(/^edit · src\/a\.ts \(modify\)/)
    expect(decision.reason).toMatch(/\d+\| -before/)
    expect(decision.reason).toMatch(/\d+\| \+after/)
  })

  it('passes an untracked tool straight through', async () => {
    expect((await harness.preExecute('read', { file_path: 'src/a.ts' })).kind).toBe('allow')
  })

  it('does not intercept the non-default str_replace_editor tool', async () => {
    const decision = await harness.preExecute('str_replace_editor', { command: 'str_replace', path: 'src/a.ts', old_str: 'before', new_str: 'after' })
    expect(decision.kind).toBe('allow')
  })

  it('passes everything through once the master switch is off', async () => {
    harness.setSwitch('editEnabled', false)
    expect((await harness.preExecute('edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' })).kind).toBe('allow')
  })

  it('delegates on a session whose policy is never', async () => {
    harness.calls.policy = 'never'
    expect((await harness.preExecute('edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' })).kind).toBe('allow')
  })
})

describe('bash interception', () => {
  it('is off by default', async () => {
    expect((await harness.preExecute('bash', { command: 'echo hi', description: 'greet' })).kind).toBe('allow')
  })

  it('asks once enabled, whether or not an agent is attached', async () => {
    harness.setSwitch('bashEnabled', true)
    expect((await harness.preExecute('bash', { command: 'git push origin main', description: 'push' })).kind).toBe('ask')
    expect((await harness.preExecute('bash', { command: 'git push origin main', description: 'push' }, false)).kind).toBe('ask')
  })

  it('passes an allow-listed command, whitespace-normalized', async () => {
    // The allow list is ORDINARY config, so it is fixed when the entry mounts.
    harness = await mount({ bashAllow: ['git status'] })
    harness.setSwitch('bashEnabled', true)
    expect((await harness.preExecute('bash', { command: 'git  status --short' })).kind).toBe('allow')
    expect((await harness.preExecute('bash', { command: 'git push origin main' })).kind).toBe('ask')
  })
})

describe('toggle commands', () => {
  const invoke = (rawInput: string) => ({ rawInput, agent: { id: 'x' }, signal: new AbortController().signal })

  it('reports both switches in status', async () => {
    const edit = harness.commands.find((c) => c.name === 'approval-edit')!
    const bash = harness.commands.find((c) => c.name === 'approval-bash')!
    expect((await edit.handler(invoke('status'))).text).toMatch(/on$/)
    expect((await bash.handler(invoke('status'))).text).toMatch(/off$/)
  })

  it('pins a non-default value and clears a default one', async () => {
    const edit = harness.commands.find((c) => c.name === 'approval-edit')!
    await edit.handler(invoke('off'))
    expect(harness.writes.at(-1)).toMatchObject({ op: 'update', ns: ENTRY_ID, payload: { editEnabled: false } })
    await edit.handler(invoke('on'))
    expect(harness.writes.at(-1)).toMatchObject({ op: 'mutate', ns: ENTRY_ID, payload: [{ op: 'unset', path: ['editEnabled'] }] })
  })

  it('addresses the profile row id on every write', async () => {
    const bash = harness.commands.find((c) => c.name === 'approval-bash')!
    await bash.handler(invoke('on'))
    expect(harness.writes.every((write) => write.ns === ENTRY_ID)).toBe(true)
  })

  it('refuses an unknown mode with usage', async () => {
    const edit = harness.commands.find((c) => c.name === 'approval-edit')!
    expect(await edit.handler(invoke('maybe'))).toMatchObject({ kind: 'error' })
  })
})
