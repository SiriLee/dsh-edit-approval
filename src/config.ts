/**
 * Edit-approval settings: this plugin entry's flat document fields, the
 * resolved per-feature settings the guards consume, and the adapter between
 * them.
 *
 * Kept free of host wiring so the defaults, the fallbacks, and the
 * clear-when-default write rule stay unit-testable in isolation; `src/index.ts`
 * is the only consumer.
 *
 * DSH 0.1.7 removed the settings-namespace registry (`settings.register`), so
 * this plugin's two former namespaces (`edit-approval`, `bash-approval`)
 * collapsed into ONE profile entry's `Config`. The fields the config page edits
 * are `.volatile()` on that schema: the host resolves them into live references
 * before `apply` runs, so a config-page write is visible at the next `.get()`
 * without a remount. Every other field stays ordinary config — excluded from
 * the form and editable only in the profile file, exactly as before.
 *
 * Field names carry a feature prefix on purpose: this entry's own `disabled:`
 * flag sits beside them in the same document, so a bare `enabled` would read as
 * the plugin switch rather than as one feature's master switch.
 *
 * @module dsh-edit-approval/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import type { EditApprovalSettings } from './guard.ts'
import type { BashApprovalSettings } from './bash-guard.ts'

/**
 * Tool names the edit-approval feature intercepts by default.
 *
 * `str_replace_editor` is deliberately ABSENT even though the package still
 * ships: it stopped being a DEFAULT tool in DSH 0.1.3, so a default install
 * can never see it. The guard branches that handle it are kept (and unit
 * tested) because adding the name to `editTools` makes them live again.
 */
export const DEFAULT_TOOLS: readonly string[] = ['write', 'edit']

/** Tool names the bash-approval feature intercepts by default. */
export const DEFAULT_BASH_TOOLS: readonly string[] = ['bash']

/** Command prefixes the bash-approval feature always passes, by default. */
export const DEFAULT_BASH_ALLOW: readonly string[] = []

/** The edit-approval defaults: schema defaults and the resolved fallbacks. */
export const DEFAULT_EDIT_APPROVAL: EditApprovalSettings = {
  enabled: true,
  tools: DEFAULT_TOOLS,
  minDiffLines: 0,
  includeCreate: true,
  includeDelete: true,
}

/** The bash-approval defaults: schema defaults and the resolved fallbacks. */
export const DEFAULT_BASH_APPROVAL: BashApprovalSettings = {
  enabled: false,
  tools: DEFAULT_BASH_TOOLS,
  allow: DEFAULT_BASH_ALLOW,
}

/**
 * The document field names the config page edits. They MUST equal the
 * `.volatile()` fields of the `Config` schema in `src/index.ts` — a name here
 * that is not volatile makes the Host refuse the write with
 * `Config field "…" is not volatile`, and a volatile field missing here is
 * simply invisible in the UI. `tests/config.spec.ts` pins the pairing.
 */
export const APPROVAL_SWITCH_FIELDS = ['editEnabled', 'bashEnabled'] as const

/** One switch field name the config page edits. */
export type ApprovalSwitchField = (typeof APPROVAL_SWITCH_FIELDS)[number]

/**
 * The live configuration this plugin reads: the two master switches the config
 * page edits (`.volatile()`, so they update without a remount) plus the
 * ordinary fields, which are plain values resolved once when the entry loads.
 *
 * The volatile/ordinary split is deliberate: a `.volatile()` field is the only
 * kind a settings write may address AND the only kind whose value can change
 * while the plugin is mounted, so marking a field volatile makes it a form
 * field by construction. Only what the config page shows is volatile.
 */
export interface ApprovalConfig {
  /** Edit-approval master switch. */
  readonly editEnabled: Volatile<boolean>
  /** Bash-approval master switch. */
  readonly bashEnabled: Volatile<boolean>
  // The array fields are mutable because that is what the schema resolves to.
  // Keeping them honest here is what lets `src/index.ts` pin its `z<Config>`
  // annotation against this interface, so a schema/interface drift fails the
  // build instead of surfacing as a runtime surprise.
  /** Intercepted edit-tool names. */
  readonly editTools: string[]
  /** Ask only when a change touches at least this many lines. */
  readonly editMinDiffLines: number
  /** Whether creating a new file asks. */
  readonly editIncludeCreate: boolean
  /** Whether clearing/emptying a file asks. */
  readonly editIncludeDelete: boolean
  /** Intercepted command-tool names. */
  readonly bashTools: string[]
  /** Always-allow command prefixes; matched after whitespace normalization. */
  readonly bashAllow: string[]
}

/**
 * The host settings service's entry write port.
 *
 * A write is a revision-fenced document mutation, so *clearing* a field is what
 * lets it re-inherit the schema default instead of pinning a copy of it.
 */
export interface ApprovalConfigWriter {
  /** Profile entry id the write addresses (the bundle patch's row id). */
  readonly entryId: string
  /** Merge field values into the entry's user layer. */
  update(entryId: string, patch: Record<string, unknown>): Promise<void>
  /** Remove fields from the entry's user layer, restoring the inherited value. */
  clear(entryId: string, fields: readonly string[]): Promise<void>
}

/** The resolved settings read/write port the guards and the commands use. */
export interface ApprovalConfigStore {
  /** The resolved edit-approval settings (always schema-valid). */
  loadEdit(): EditApprovalSettings
  /** The resolved bash-approval settings. */
  loadBash(): BashApprovalSettings
  /** Persist one master switch; rejects without a configurable entry. */
  saveSwitch(field: ApprovalSwitchField, next: boolean): Promise<void>
}

/**
 * Adapter over the entry's live `Config` and the host's write port.
 *
 * Reads re-read the volatile references, so a config-page write is visible at
 * the next read with no remount and no cache to invalidate — which is why the
 * guards call `load()` per interception rather than capturing a snapshot.
 *
 * Writes apply the clear-when-default rule: a value equal to the schema default
 * is UNSET rather than pinned. That keeps the profile patch to what the user
 * actually changed and lets a later default change still reach them — pinning a
 * copy of today's default would silently opt the user out of it forever.
 *
 * @param config - the resolved entry configuration (live references).
 * @param writer - the entry write port; absent for an entry-less mount, which
 * makes every write reject instead of silently doing nothing.
 * @returns the store the commands and the interception read.
 */
export function volatileApprovalStore(
  config: ApprovalConfig,
  writer: ApprovalConfigWriter | undefined,
): ApprovalConfigStore {
  return {
    loadEdit: () => ({
      enabled: config.editEnabled.get() ?? DEFAULT_EDIT_APPROVAL.enabled,
      tools: config.editTools,
      minDiffLines: config.editMinDiffLines,
      includeCreate: config.editIncludeCreate,
      includeDelete: config.editIncludeDelete,
    }),
    loadBash: () => ({
      enabled: config.bashEnabled.get() ?? DEFAULT_BASH_APPROVAL.enabled,
      tools: config.bashTools,
      allow: config.bashAllow,
    }),
    saveSwitch: async (field, next) => {
      if (writer === undefined) {
        throw new Error('dsh-edit-approval: no configurable plugin entry to write to')
      }
      const fallback = field === 'editEnabled'
        ? DEFAULT_EDIT_APPROVAL.enabled
        : DEFAULT_BASH_APPROVAL.enabled
      if (next === fallback) await writer.clear(writer.entryId, [field])
      else await writer.update(writer.entryId, { [field]: next })
    },
  }
}
