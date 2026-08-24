import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/** Minimal stub of the SettingsScope returned by `ctx.settings.register`. */
interface StubScope {
  get(): Record<string, unknown>
  update(patch: Record<string, unknown>): Promise<void>
  replace(section: Record<string, unknown>): Promise<void>
  watch(): () => void
}

function stubScope(initial: Record<string, unknown>): StubScope {
  let value = { ...initial }
  return {
    get: () => ({ ...value }),
    update: async (patch) => { value = { ...value, ...patch } },
    replace: async (section) => { value = { ...section } },
    watch: () => () => {},
  }
}

interface Harness {
  ctx: Context
  files: Map<string, string>
  commands: Array<{ name: string; handler: (invocation: { rawInput: string }) => unknown }>
  settings: StubScope
  dispose(): Promise<void>
}

/** Wait until a predicate holds (the dynamic inject callback mounts on a later tick). */
async function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = (): void => {
      if (predicate()) return resolve()
      if (Date.now() - started > 2000) return reject(new Error('timed out waiting for plugin mount'))
      setTimeout(check, 1)
    }
    check()
  })
}

/** Schema defaults the real SettingsScope would resolve; the stub mimics them. */
const SETTINGS_DEFAULTS: Record<string, unknown> = {
  enabled: true,
  tools: ['write', 'edit', 'str_replace_editor'],
  minDiffLines: 0,
  includeCreate: true,
  includeDelete: true,
}

/** Mount the host plugin on a bare cordis Context with stub services. */
async function mount(options: { approvalPolicy?: 'ask' | 'never' } = {}): Promise<Harness> {
  const ctx = new Context()
  const files = new Map<string, string>()
  const commands: Harness['commands'] = []
  let settings: StubScope = stubScope({})

  ctx.provide('fs', {
    resolve: async (path: string) => ({ targetKey: path, displayPath: path }),
    stat: async (target: { displayPath: string }) => (files.has(target.displayPath)
      ? { version: 1, type: 'file' as const }
      : undefined),
    readText: async (target: { displayPath: string }) => files.get(target.displayPath) ?? '',
  })
  ctx.provide('commands', {
    register: (definition: Harness['commands'][number]) => {
      commands.push(definition)
      return () => {}
    },
  })
  ctx.provide('settings', {
    register: (_ns: unknown, _schema: unknown, options?: { base?: Record<string, unknown> }) => {
      settings = stubScope({ ...SETTINGS_DEFAULTS, ...options?.base })
      return settings
    },
  })
  // The approval service double: session override with the configured default,
  // mirroring how the plugin reads the effective policy.
  if (options.approvalPolicy !== undefined) {
    ctx.provide('approval', {
      overrideOf: () => options.approvalPolicy,
      config: { policy: options.approvalPolicy },
    })
  }

  const fiber = ctx.plugin(plugin as never)
  // The dynamic ctx.inject callback registers the listener and commands on a
  // later tick; the harness must observe the fully mounted plugin.
  await waitFor(() => commands.length === 1)

  return {
    ctx,
    files,
    commands,
    settings,
    dispose: () => fiber.dispose(),
  }
}

/** Dispatch one tool call through the `tools/pre-execute` waterfall. */
function preExecute(h: Harness, name: string, args: Record<string, unknown>): Promise<PreToolDecision> {
  const exec = { callId: 'c1', name, arguments: args, signal: new AbortController().signal }
  return h.ctx.waterfall(
    h.ctx,
    'tools/pre-execute',
    exec as never,
    () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
  )
}

/** Dispatch one tool call with a caller agent (session policy lookups need one). */
function preExecuteAsAgent(h: Harness, name: string, args: Record<string, unknown>): Promise<PreToolDecision> {
  const exec = {
    callId: 'c-agent',
    name,
    arguments: args,
    agent: { id: 'a1', session: { header: { cwd: '/workspace' } } },
    signal: new AbortController().signal,
  }
  return h.ctx.waterfall(
    h.ctx,
    'tools/pre-execute',
    exec as never,
    () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
  )
}

describe('host plugin integration (bare cordis context + stub services)', () => {
  it('asks for an edit that changes an existing file', async () => {
    const h = await mount()
    try {
      h.files.set('src/a.ts', 'before\nunchanged')
      const decision = await preExecute(h, 'edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' })
      expect(decision.kind).toBe('ask')
      if (decision.kind === 'ask') {
        expect(decision.reason).toMatch(/^edit · src\/a\.ts \(modify\): 1 insertion, 1 deletion$/m)
        expect(decision.reason).toMatch(/\d+ -before/)
        expect(decision.reason).toMatch(/\d+ \+after/)
      }
    } finally {
      await h.dispose()
    }
  })

  it('passes through under the never policy instead of auto-rejecting edits', async () => {
    // Full access (danger-full-access preset) intends no prompting: an `ask`
    // here would be deterministically rejected by the approval service and
    // silently break every edit. The plugin must delegate.
    const h = await mount({ approvalPolicy: 'never' })
    try {
      h.files.set('src/a.ts', 'before\nunchanged')
      const decision = await preExecuteAsAgent(h, 'edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' })
      expect(decision).toEqual({ kind: 'allow' })
    } finally {
      await h.dispose()
    }
  })

  it('still asks under the ask policy with a caller agent', async () => {
    const h = await mount({ approvalPolicy: 'ask' })
    try {
      h.files.set('src/a.ts', 'before\nunchanged')
      const decision = await preExecuteAsAgent(h, 'edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' })
      expect(decision.kind).toBe('ask')
    } finally {
      await h.dispose()
    }
  })

  it('passes when the plugin is disabled', async () => {
    const h = await mount()
    try {
      await h.settings.update({ enabled: false })
      const decision = await preExecute(h, 'write', { file_path: 'a.ts', content: 'x' })
      expect(decision).toEqual({ kind: 'allow' })
    } finally {
      await h.dispose()
    }
  })

  it('passes on str_replace_editor view commands', async () => {
    const h = await mount()
    try {
      const decision = await preExecute(h, 'str_replace_editor', { command: 'view', path: '/x' })
      expect(decision).toEqual({ kind: 'allow' })
    } finally {
      await h.dispose()
    }
  })

  it('registers the /approval-edit command', async () => {
    const h = await mount()
    try {
      const names = h.commands.map(command => command.name).sort()
      expect(names).toEqual(['approval-edit'])

      const edit = h.commands.find(command => command.name === 'approval-edit')!
      expect(await edit.handler({ rawInput: 'status' })).toMatchObject({ text: 'edit approval is on' })
      expect(await edit.handler({ rawInput: 'off' })).toMatchObject({ kind: 'success' })
      expect(h.settings.get().enabled).toBe(false)
      expect(await edit.handler({ rawInput: 'status' })).toMatchObject({ text: 'edit approval is off' })
    } finally {
      await h.dispose()
    }
  })

  it('does not break when the preview read fails', async () => {
    const h = await mount()
    try {
      h.files.set('broken', 'x')
      // Force readText to throw for this path.
      const original = h.ctx.get('fs') as { readText: (t: { displayPath: string }) => Promise<string> }
      original.readText = async () => { throw new Error('boom') }
      const decision = await preExecute(h, 'write', { file_path: 'broken', content: 'y' })
      expect(decision).toEqual({ kind: 'allow' })
    } finally {
      await h.dispose()
    }
  })
})
