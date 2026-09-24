/**
 * The client half's configuration contract, stated as literals in a module with
 * no imports.
 *
 * Why it is spelled here instead of imported from the host: a client package
 * must NOT depend on a host package (the harness's bundle-purity rule, and the
 * reason `tsconfig.client.json` pins `rootDir: src/client` — importing
 * `../config.ts` would pull the whole host half into the client program). The
 * official companion pages spell foreign namespace literals for the same
 * reason.
 *
 * The duplication is pinned, not trusted: `tests/config.spec.ts` reads the REAL
 * schema's serialized envelope and asserts its volatile field set equals
 * {@link APPROVAL_SWITCH_FIELDS} and that the defaults below match the resolved
 * schema, so a drift fails the suite rather than silently making the Host
 * refuse a write (`Config field "…" is not volatile`).
 *
 * @module dsh-edit-approval/client/policy
 */

/**
 * The document fields the config card edits, in render order.
 *
 * MUST equal the `.volatile()` fields of the host `Config` schema: a field here
 * that is not volatile makes the Host refuse the write, and a volatile field
 * missing here is invisible in the UI.
 */
export const APPROVAL_SWITCH_FIELDS = ['editEnabled', 'bashEnabled'] as const

/** One field the config card edits. */
export type ApprovalSwitchField = (typeof APPROVAL_SWITCH_FIELDS)[number]

/** The edit-approval master switch's schema default. */
export const DEFAULT_EDIT_ENABLED = true

/** The bash-approval master switch's schema default. */
export const DEFAULT_BASH_ENABLED = false

/** The schema default each switch clears back to. */
export const SWITCH_DEFAULTS: Readonly<Record<ApprovalSwitchField, boolean>> = {
  editEnabled: DEFAULT_EDIT_ENABLED,
  bashEnabled: DEFAULT_BASH_ENABLED,
}
