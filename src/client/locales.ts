/**
 * Locale dictionaries for the client half — the single source of truth for the
 * config card's copy and the approval panel's disclosure labels.
 *
 * Registered with the harness locale service (`ctx.locale.register`) in
 * {@link ./index.ts}, so every string follows the user's dsh language
 * preference rather than `navigator.language`.
 *
 * ONE namespace covers the whole plugin: DSH 0.1.7 collapsed the two settings
 * namespaces this plugin used to register into one profile entry, and the copy
 * follows that — a per-feature namespace would now name a surface that no
 * longer exists.
 *
 * @module dsh-edit-approval/client/locales
 */

/** Dictionary namespace for the plugin's client copy (declared in `LocaleNamespaceMap`). */
export const NS = 'edit-approval'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.edit.title': '编辑审批',
  'settings.edit.hint.on': '修改文件前弹出 diff 审批',
  'settings.edit.hint.off': '不拦截文件修改',
  'settings.bash.title': '命令审批',
  'settings.bash.hint.on': '执行命令前弹出审批',
  'settings.bash.hint.off': '不拦截命令执行',
  'form.unavailable': '本部署未向此页面提供该插件的配置。',
  'form.readonly': '本部署的设置为只读。',
  'form.saveFailed': '本部署没有接受这些值，已保留供你修改。',
  'form.save': '保存',
  'form.saving': '保存中…',
  'approval.collapse': '折叠审批详情',
  'approval.expand': '展开审批详情',
} as const

/** English dictionary. */
export const en: Record<ApprovalKey, string> = {
  'settings.edit.title': 'Edit approval',
  'settings.edit.hint.on': 'Ask before editing files, with a line diff',
  'settings.edit.hint.off': 'File edits are not intercepted',
  'settings.bash.title': 'Command approval',
  'settings.bash.hint.on': 'Ask before running commands',
  'settings.bash.hint.off': 'Commands are not intercepted',
  'form.unavailable': 'This deployment does not serve this plugin’s configuration here.',
  'form.readonly': 'Settings are read-only on this deployment.',
  'form.saveFailed': 'This deployment did not accept these values; they are kept for you to fix.',
  'form.save': 'Save',
  'form.saving': 'Saving…',
  'approval.collapse': 'Collapse approval details',
  'approval.expand': 'Expand approval details',
}

/** Dictionary key union (derived from the zh source of truth). */
export type ApprovalKey = keyof typeof zh
