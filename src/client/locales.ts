/**
 * Locale dictionaries for both approval features — the single source of truth
 * for the Settings → General row copy. Registered with the harness locale
 * service (`ctx.locale.register`) in {@link ./index.ts}, so the rows follow
 * the user's dsh language preference (`locale.preference`), not `navigator`.
 *
 * Namespace convention mirrors the host: `<tool>-approval` per feature.
 *
 * @module dsh-edit-approval/client/locales
 */

/** Dictionary namespace for the edit-approval feature (declared in `LocaleNamespaceMap`). */
export const NS = 'edit-approval'

/** Dictionary namespace for the bash-approval feature (declared in `LocaleNamespaceMap`). */
export const BASH_NS = 'bash-approval'

/** Simplified Chinese dictionary for edit approval (the key-set source of truth). */
export const zh = {
  'settings.title': '编辑前审批',
  'settings.description': '写类工具（write/edit/str_replace_editor）执行前弹出 diff 审批',
  'approval.collapse': '折叠审批详情',
  'approval.expand': '展开审批详情',
} as const

/** English dictionary for edit approval. */
export const en: Record<EditApprovalKey, string> = {
  'settings.title': 'Edit approval',
  'settings.description': 'Ask before write/edit/str_replace_editor with a line diff',
  'approval.collapse': 'Collapse approval details',
  'approval.expand': 'Expand approval details',
}

/** Edit-approval dictionary key union (derived from the zh source of truth). */
export type EditApprovalKey = keyof typeof zh

/** Simplified Chinese dictionary for bash approval (the key-set source of truth). */
export const bashZh = {
  'settings.title': '命令审批',
  'settings.description': 'bash 命令执行前弹出审批（支持总是通过列表）',
} as const

/** English dictionary for bash approval. */
export const bashEn: Record<BashApprovalKey, string> = {
  'settings.title': 'Bash approval',
  'settings.description': 'Ask before bash commands (allow-list aware)',
}

/** Bash-approval dictionary key union (derived from the zh source of truth). */
export type BashApprovalKey = keyof typeof bashZh
