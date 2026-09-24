import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import {
  APPROVAL_SWITCH_FIELDS,
  DEFAULT_BASH_ALLOW,
  DEFAULT_BASH_APPROVAL,
  DEFAULT_BASH_TOOLS,
  DEFAULT_EDIT_APPROVAL,
  DEFAULT_TOOLS,
  volatileApprovalStore,
  type ApprovalConfig,
} from '../src/config.ts'
import {
  APPROVAL_SWITCH_FIELDS as CLIENT_SWITCH_FIELDS,
  SWITCH_DEFAULTS,
} from '../src/client/policy.ts'

/** The serialized Schemastery envelope the settings wire itself carries. */
interface SchemaEnvelope {
  readonly uid: string | number
  readonly refs: Record<string, {
    readonly dict?: Record<string, string | number>
    readonly meta?: { readonly volatile?: boolean }
  }>
}

/** One recorded write against the fake entry port. */
interface WriteRecord {
  readonly kind: 'update' | 'clear'
  readonly entryId: string
  readonly payload: unknown
}

/** A store over a fake live config plus a recording entry port. */
function harness(options: { readonly writer?: boolean } = {}) {
  let editEnabled: boolean | undefined = true
  let bashEnabled: boolean | undefined = false
  const writes: WriteRecord[] = []
  const config = {
    editEnabled: { get: () => editEnabled },
    bashEnabled: { get: () => bashEnabled },
    editTools: [...DEFAULT_TOOLS],
    editMinDiffLines: 3,
    editIncludeCreate: false,
    editIncludeDelete: false,
    bashTools: [...DEFAULT_BASH_TOOLS],
    bashAllow: ['git status'],
  } as unknown as ApprovalConfig
  const writer = options.writer === false ? undefined : {
    entryId: 'dsh-edit-approval',
    update: async (entryId: string, patch: Record<string, unknown>) => {
      writes.push({ kind: 'update', entryId, payload: patch })
    },
    clear: async (entryId: string, fields: readonly string[]) => {
      writes.push({ kind: 'clear', entryId, payload: fields })
    },
  }
  return {
    store: volatileApprovalStore(config, writer),
    writes,
    setEdit: (value: boolean | undefined) => { editEnabled = value },
    setBash: (value: boolean | undefined) => { bashEnabled = value },
  }
}

describe('Config schema', () => {
  it('exposes exactly the config page fields as volatile', () => {
    // The invariant the config page depends on: a field the card edits that is
    // NOT volatile makes the Host refuse the write with `Config field "…" is
    // not volatile`, and a volatile field the card omits is invisible. Reading
    // `toJSON()` uses the same projection the settings wire carries.
    const envelope = Config.toJSON() as SchemaEnvelope
    const root = envelope.refs[String(envelope.uid)]
    const volatileFields = Object.entries(root?.dict ?? {})
      .filter(([, ref]) => envelope.refs[String(ref)]?.meta?.volatile === true)
      .map(([name]) => name)
      .sort()
    expect(volatileFields).toEqual([...APPROVAL_SWITCH_FIELDS].sort())
  })

  it('resolves the documented defaults, switches included', () => {
    const validated = Config['~standard'].validate({})
    const value = validated.value as ApprovalConfig
    expect(validated.issues).toBeUndefined()
    expect(value.editEnabled.get()).toBe(DEFAULT_EDIT_APPROVAL.enabled)
    expect(value.bashEnabled.get()).toBe(DEFAULT_BASH_APPROVAL.enabled)
    expect(value.editTools).toEqual([...DEFAULT_TOOLS])
    expect(value.editMinDiffLines).toBe(DEFAULT_EDIT_APPROVAL.minDiffLines)
    expect(value.editIncludeCreate).toBe(DEFAULT_EDIT_APPROVAL.includeCreate)
    expect(value.editIncludeDelete).toBe(DEFAULT_EDIT_APPROVAL.includeDelete)
    expect(value.bashTools).toEqual([...DEFAULT_BASH_TOOLS])
    expect(value.bashAllow).toEqual([...DEFAULT_BASH_ALLOW])
  })

  it('carries no field beyond the documented eight', () => {
    const value = Config['~standard'].validate({}).value as Record<string, unknown>
    expect(Object.keys(value).sort()).toEqual([
      'bashAllow', 'bashEnabled', 'bashTools',
      'editEnabled', 'editIncludeCreate', 'editIncludeDelete',
      'editMinDiffLines', 'editTools',
    ])
  })

  it('no longer declares the removed always-allow / namespace-era keys', () => {
    // `alwaysAllow` was removed in f182d92 (split into a standalone plugin) and
    // survived only as an orphan key in user documents. It must not come back.
    const value = Config['~standard'].validate({}).value as Record<string, unknown>
    expect(Object.keys(value)).not.toContain('alwaysAllow')
    expect(Object.keys(value)).not.toContain('bash')
  })

  it('keeps str_replace_editor out of the default interception list', () => {
    expect([...DEFAULT_TOOLS]).toEqual(['write', 'edit'])
  })
})

describe('volatileApprovalStore reads', () => {
  it('resolves the ordinary fields straight from the document', () => {
    const { store } = harness()
    expect(store.loadEdit()).toEqual({
      enabled: true,
      tools: [...DEFAULT_TOOLS],
      minDiffLines: 3,
      includeCreate: false,
      includeDelete: false,
    })
    expect(store.loadBash()).toEqual({
      enabled: false,
      tools: [...DEFAULT_BASH_TOOLS],
      allow: ['git status'],
    })
  })

  it('re-reads the live switches on every call (no captured snapshot)', () => {
    const { store, setEdit, setBash } = harness()
    expect(store.loadEdit().enabled).toBe(true)
    expect(store.loadBash().enabled).toBe(false)
    setEdit(false)
    setBash(true)
    expect(store.loadEdit().enabled).toBe(false)
    expect(store.loadBash().enabled).toBe(true)
  })

  it('falls back to the schema defaults when a switch reads undefined', () => {
    const { store, setEdit, setBash } = harness()
    setEdit(undefined)
    setBash(undefined)
    expect(store.loadEdit().enabled).toBe(DEFAULT_EDIT_APPROVAL.enabled)
    expect(store.loadBash().enabled).toBe(DEFAULT_BASH_APPROVAL.enabled)
  })
})

describe('volatileApprovalStore writes', () => {
  it('pins a non-default value onto the entry row', async () => {
    const { store, writes } = harness()
    await store.saveSwitch('editEnabled', false)
    expect(writes).toEqual([
      { kind: 'update', entryId: 'dsh-edit-approval', payload: { editEnabled: false } },
    ])
  })

  it('clears a switch that equals its default instead of pinning a copy', async () => {
    // Pinning today's default would silently opt the user out of a later
    // default change; clearing lets the field re-inherit the schema.
    const { store, writes } = harness()
    await store.saveSwitch('editEnabled', true)
    await store.saveSwitch('bashEnabled', false)
    expect(writes).toEqual([
      { kind: 'clear', entryId: 'dsh-edit-approval', payload: ['editEnabled'] },
      { kind: 'clear', entryId: 'dsh-edit-approval', payload: ['bashEnabled'] },
    ])
  })

  it('pins the bash switch when it is turned on', async () => {
    const { store, writes } = harness()
    await store.saveSwitch('bashEnabled', true)
    expect(writes).toEqual([
      { kind: 'update', entryId: 'dsh-edit-approval', payload: { bashEnabled: true } },
    ])
  })

  it('rejects rather than silently dropping a write without an entry', async () => {
    const { store, writes } = harness({ writer: false })
    await expect(store.saveSwitch('editEnabled', false)).rejects.toThrow(/no configurable plugin entry/)
    expect(writes).toEqual([])
  })
})

describe('client configuration contract', () => {
  /** The schema's volatile top-level field names, read from its own envelope. */
  function volatileFieldsOfSchema(): string[] {
    const envelope = Config.toJSON() as SchemaEnvelope
    const root = envelope.refs[String(envelope.uid)]
    return Object.entries(root?.dict ?? {})
      .filter(([, ref]) => envelope.refs[String(ref)]?.meta?.volatile === true)
      .map(([name]) => name)
      .sort()
  }

  it('states the same field list the schema makes volatile', () => {
    // The client half spells its field list locally (a client package must not
    // depend on a host package), so the two are pinned here rather than
    // trusted: a client-only field makes the Host refuse the write, and a
    // volatile field the client omits is invisible in the UI.
    expect([...CLIENT_SWITCH_FIELDS].sort()).toEqual(volatileFieldsOfSchema())
    expect([...APPROVAL_SWITCH_FIELDS].sort()).toEqual(volatileFieldsOfSchema())
  })

  it('states the same defaults the schema resolves', () => {
    const value = Config['~standard'].validate({}).value as ApprovalConfig
    expect(SWITCH_DEFAULTS.editEnabled).toBe(value.editEnabled.get())
    expect(SWITCH_DEFAULTS.bashEnabled).toBe(value.bashEnabled.get())
  })
})
