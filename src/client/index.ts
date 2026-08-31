/**
 * dsh-edit-approval — browser half.
 *
 * Rebuilds the approval panel's diff headline as red/green per-line blocks
 * (the reason is plain text; per-line coloring is impossible without this)
 * and registers the two feature master switches into Settings → General:
 * "Edit approval" (`edit-approval`) and "Bash approval" (`bash-approval`).
 *
 * Pure DOM injection: no new page, no new popup — the panel's stable data
 * attribute is the only anchor. The tool name comes from the session's
 * pending approval payload (`session.getSnapshot().pending`), so the host
 * command receives the exact tool that is asking. All side effects are
 * registered as one `ctx.effect`, so plugin unload / HMR tears them down.
 *
 * The bash feature needs NO panel enhancement: the diff coloring, collapse
 * button, and focus restore are panel-level and apply to every approval —
 * multi-line commands already get `pre-wrap` and long ones the collapse.
 *
 * @module dsh-edit-approval/client
 */

// Type-only: both are module-table words, never inlined; the runtime code
// below touches only the DOM and the session face.
import type { ClientContext, SessionFace, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings slot declaration ('settings.general.item').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale service merge (`ctx.locale`) and the slot
// declaration; runtime copy comes from the locale dictionary below.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ApprovalToggleRow } from './settings-row.tsx'
import { COLLAPSE_STYLE, installCollapseButton } from './collapse.ts'
import { isDiffReason, renderDiffRows } from './diff-rows.ts'
import { FocusRestore } from './refocus.ts'
import { CHAT_VIEW, chatSnapshotOf, uiConversationOf, type ChatSnapshotLike } from './conversation.ts'
import { BASH_NS, bashEn, bashZh, en, NS, zh, type BashApprovalKey, type EditApprovalKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The edit-approval Settings → General row copy. */
    'edit-approval': EditApprovalKey
    /** The bash-approval Settings → General row copy. */
    'bash-approval': BashApprovalKey
  }
}

/** Stable plugin name. */
export const name = 'dsh-edit-approval/client'

/** Required services: sessions (pending approvals), slots (the settings rows), locale (row copy), settingsScope (read the switches). */
export const inject = ['sessions', 'slots', 'locale', 'settingsScope']

/** Settings namespaces backing the runtime toggles (mirror the host plugin). */
const SETTINGS_NAMESPACE = 'edit-approval'
const BASH_SETTINGS_NAMESPACE = 'bash-approval'

/** The enabled flag the settings rows read (a subset of the host schemas). */
interface ApprovalClientSettings {
  enabled: boolean
}

/** The approval panel root anchor (set by ApprovalPanel.tsx). */
const PANEL_SELECTOR = '[data-approval-key]'

/**
 * Plugin-side compensation for a harness presentation quirk: the approval
 * panel headlines the `reason` text in `.headline`, whose CSS has no
 * `white-space: pre-wrap`, so HTML collapses the `\n` line breaks of our
 * multi-line diff into spaces. This rule targets the headline by stable
 * structural anchors (the panel root and the scrollable body seat, both
 * data attributes) and restores the line structure. Harmless if the harness
 * ever adds `pre-wrap` upstream — the selector simply stops matching nothing
 * extra.
 */
const PREWRAP_STYLE = [
  `[data-approval-key] [data-approval-scroll] > div:first-child { white-space: pre-wrap; }`,
].join('\n')

/**
 * Red/green diff rendering: the panel headlines the reason as plain text
 * (no per-line coloring possible), so this plugin rebuilds the headline as
 * one block per line — `+` lines green, `-` lines red, grey context (the
 * host's 3-line window) and `⋯` hunk gaps muted — plus a monospace font to
 * read like a code diff. Purely additive DOM; the panel is mounted once per
 * approval and never re-renders the reason text, so the replacement cannot
 * be clobbered by React.
 *
 * Every selector is scoped to the `dsh-ea-kind-diff` marker `enhance()` adds
 * to the panel root, so the diff look never leaks onto other approval kinds
 * (bash command approvals keep the panel's native styling).
 */
const DIFF_STYLE = [
  '[data-approval-key].dsh-ea-kind-diff [data-approval-scroll] > div:first-child {',
  '  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);',
  '  font-size: 13px;',
  '  line-height: 20px;',
  '}',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-add { color: var(--dsw-alias-state-success-primary, #2f9e44); }',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-remove { color: var(--dsw-alias-state-error-primary, #e03131); }',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-context { color: var(--dsw-alias-label-tertiary, #868e96); }',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-ellipsis { color: var(--dsw-alias-label-tertiary, #868e96); opacity: .6; padding-left: 8px; }',
].join('\n')

/** The panel's headline seat (stable data-attribute anchor, same as PREWRAP). */
const HEADLINE_SELECTOR = '[data-approval-scroll] > div:first-child'

/** Panels already enhanced in this page lifetime. */
const enhanced = new WeakSet<Element>()

/**
 * Whether a pending approval exists behind one panel key (the diff renders
 * only for approvals). Dual channel: on rc.2 the session-face snapshot still
 * carries `pending` (`PendingWait[]`) and the panel key matches a pending
 * item; on alpha.1+ the face no longer exposes `pending` (the split moved it
 * to the ui-conversation surface) and the `[data-approval-key]` panel in the
 * DOM IS the pending-approval presentation, so a present panel is accepted.
 */
function hasPendingApproval(ctx: ClientContext, key: string): boolean {
  let sawPendingSurface = false
  for (const id of ctx.sessions.list.getSnapshot().ids) {
    const binding = ctx.sessions.binding(id)
    if (binding === undefined) continue
    const pending = (binding.session.getSnapshot() as { pending?: readonly unknown[] }).pending
    if (pending === undefined) continue
    sawPendingSurface = true
    if (pending.some((item) => {
      const p = item as { kind?: string; key?: string }
      return p.kind === 'approval' && p.key === key
    })) return true
  }
  // rc.2: a pending surface exists but the approval is not visible yet — keep
  // waiting for a later mutation. alpha.1+: no session exposes `pending`, so
  // the panel is the pending presentation — accept it (never a false wait).
  return sawPendingSurface ? false : true
}

/** Rebuild the diff headline of one freshly rendered approval panel. */
function enhance(ctx: ClientContext, panel: Element, t: (key: EditApprovalKey) => string): boolean {
  const key = panel.getAttribute('data-approval-key')
  if (key === null) return false
  if (!hasPendingApproval(ctx, key)) return false // pending not visible yet; a later mutation retries
  const headline = panel.querySelector<HTMLElement>(HEADLINE_SELECTOR)
  if (headline !== null) {
    const text = headline.textContent ?? ''
    if (isDiffReason(text)) {
      // Diff kind (edit approvals): the red/green rebuild plus the collapse
      // button, and the diff styles scoped to this marker.
      panel.classList.add('dsh-ea-kind-diff')
      renderDiffRows(headline)
      // Collapse button: only for real (multi-line) diffs, at the strip's right end.
      if (text.includes('\n')) {
        installCollapseButton(panel, { collapse: t('approval.collapse'), expand: t('approval.expand') })
      }
    } else {
      // Command kind (bash approvals): keep the panel's native look — the
      // headline shows the short reason and the command row renders natively
      // from the tool call. Only the kind marker is added; diff styles never
      // apply here, so the two approval kinds stay visually distinct.
      panel.classList.add('dsh-ea-kind-command')
    }
  }
  return true
}

/** Scan the document for approval panels that are not yet enhanced. */
function scan(ctx: ClientContext, t: (key: EditApprovalKey) => string): void {
  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    if (enhanced.has(panel)) continue
    // Mark only on success so a panel whose pending approval is not yet
    // visible (transient) is retried on the next mutation.
    if (enhance(ctx, panel, t)) enhanced.add(panel)
  }
}

/**
 * Read the latest `<commandName>` command outcome ("... is on/off") at or
 * after `fromIndex` in the chat order from the given (dual-channel) chat
 * snapshot, or null when none has settled yet. The index baseline lets a
 * caller wait for a FRESH outcome instead of the stale one from a command it
 * just issued. `undefined` chat (neither channel available) reads as no
 * outcome — the caller keeps waiting — never a crash.
 */
function approvalStatus(chat: ChatSnapshotLike | undefined, fromIndex = 0, commandName = 'approval-edit'): boolean | null {
  if (chat === undefined) return null
  let last: string | undefined
  for (let index = fromIndex; index < chat.order.length; index += 1) {
    const key = chat.order[index]!
    const node = chat.nodes.get(key) as
      | { kind?: string; data?: { name?: string; outcome?: { kind?: string; text?: string } } }
      | undefined
    if (node?.kind !== 'command') continue
    const command = node.data
    if (command?.name === commandName && command.outcome?.text !== undefined) {
      last = command.outcome.text
    }
  }
  if (last === undefined) return null
  // Accepts both the status wording ("... is on") and the toggle wording
  // ("... turned on"); both commands' success texts end in " on" / " off".
  return /(?:is|turned) on$/.test(last)
}

/** Resolve the current session face (the settings page opens within one). */
function currentSessionOf(ctx: ClientContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id === undefined ? undefined : ctx.sessions.binding(id)?.session
}

/**
 * Wait until a `<commandName>` command outcome at/after `base` (the chat order
 * length captured BEFORE dispatching the command) settles in the session chat.
 * The chat is re-read through `chatOf` (the dual-channel reader) on every
 * check, so the baselined outcome comes from the live chat regardless of the
 * harness generation. Settling on the command's own baselined outcome
 * guarantees we read what that command committed — never a stale earlier
 * outcome. Resolves `null` on timeout.
 */
async function waitForApprovalOutcome(
  chatOf: (session: SessionFace | undefined) => ChatSnapshotLike | undefined,
  session: SessionFace,
  base: number,
  commandName: string,
  timeoutMs = 4000,
): Promise<boolean | null> {
  return await new Promise<boolean | null>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (value: boolean | null): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const check = (): void => {
      const value = approvalStatus(chatOf(session), base, commandName)
      if (value !== null) settle(value)
    }
    const unsubscribe = session.subscribe(check)
    timer = setTimeout(() => settle(null), timeoutMs)
    check()
  })
}

/** Read the master switch from the settings scope, or null until it settles. */
function readEnabled(scope: SettingsScope<ApprovalClientSettings>): boolean | null {
  const snapshot = scope.getSnapshot()
  return snapshot.status === 'ready' && snapshot.value !== undefined ? snapshot.value.enabled : null
}

/** The Settings → General row face bound to one feature's host command. */
function toggleRow(ctx: ClientContext, commandName: string, namespace: string) {
  const settingsScope = ctx.settingsScope.bind<ApprovalClientSettings>({ namespace })
  // Dual-channel chat reader: the rc.2 session-face snapshot first, then the
  // alpha.1+ uiConversation "chat" view. Re-read on every call (services
  // restart under the live-reload profile patcher) and degrades to undefined —
  // it never throws, so an unknown/teardown session cannot break the toggle.
  const chatOf = (session: SessionFace | undefined): ChatSnapshotLike | undefined => {
    if (session === undefined) return undefined
    try {
      const view = uiConversationOf(ctx)?.binding(session.sessionId).target(CHAT_VIEW)
      return chatSnapshotOf(session, view)
    } catch {
      return undefined
    }
  }
  return {
    getStatus: async (): Promise<boolean | null> => {
      const immediate = readEnabled(settingsScope)
      if (immediate !== null) return immediate
      // Still loading: wait for the first settled snapshot, then resolve
      // null so the row stays disabled rather than guessing.
      return await new Promise<boolean | null>((resolve) => {
        let settled = false
        const settle = (value: boolean | null): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          unsubscribe()
          resolve(value)
        }
        const unsubscribe = settingsScope.subscribe(() => {
          const value = readEnabled(settingsScope)
          if (value !== null) settle(value)
        })
        const timer = setTimeout(() => settle(null), 4000)
      })
    },
    // Resolves with the value the host committed: the toggle command's
    // own baselined outcome, not a later guess.
    toggle: async (next: boolean): Promise<boolean | null> => {
      const session = currentSessionOf(ctx)
      if (session === undefined) return null
      const base = chatOf(session)?.order.length ?? 0
      await session.command(`/${commandName} ${next ? 'on' : 'off'}`)
      return await waitForApprovalOutcome(chatOf, session, base, commandName)
    },
  }
}

/**
 * Mount the browser half: inject the diff styles, register the two
 * Settings → General master-switch rows, and observe approval panels to
 * enhance them. Disposal unwinds everything.
 * @param ctx - client root context carrying `sessions`, `slots`.
 */
export function apply(ctx: ClientContext): void {
  // Locale dictionaries: the Settings → General row copy follows the user's
  // dsh language preference. Registered once for the plugin's lifetime.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-edit-approval: locale dictionaries')
  ctx.effect(() => ctx.locale.register(BASH_NS, { zh: bashZh, en: bashEn }), 'dsh-edit-approval: bash locale dictionaries')

  // Bound translate seat for the panel copy (collapse/expand labels).
  const t = ctx.locale.bind(NS)

  ctx.effect(function* () {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-edit-approval'
    style.textContent = `${PREWRAP_STYLE}\n${DIFF_STYLE}\n${COLLAPSE_STYLE}`
    document.head.appendChild(style)

    // Settings → General rows: the two feature master switches. Reads go
    // through the local settings scope (no session command, so opening the
    // settings page never prints `/approval-*` into the chat); writes go
    // through the host toggle commands — the route proven to persist, unlike
    // the client settingsScope write for this namespace. `locale: NS`
    // synthesizes the `t` seat on the row's props.
    const unbindEditRow = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'edit-approval',
      order: 30,
      locale: NS,
      inject: () => toggleRow(ctx, 'approval-edit', SETTINGS_NAMESPACE),
    }, ApprovalToggleRow))
    const unbindBashRow = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'bash-approval',
      order: 31,
      locale: BASH_NS,
      inject: () => toggleRow(ctx, 'approval-bash', BASH_SETTINGS_NAMESPACE),
    }, ApprovalToggleRow))

    let observer: MutationObserver | undefined
    let scanFrame: number | undefined
    // Approval resolution focus-restore: while the panel is up, the user's
    // focus is on its approve/reject button, so removing the panel drops the
    // caret to <body>. When a `[data-approval-key]` panel is removed from the
    // DOM (the approval resolved), hand focus back to the last editable seat
    // the user was typing in (the composer). See refocus.ts for the guards.
    const focusRestore = new FocusRestore()
    document.addEventListener('focusin', focusRestore.onFocusIn, true)
    const containsPanel = (root: Element): boolean =>
      root.matches(PANEL_SELECTOR) || root.querySelector(PANEL_SELECTOR) !== null
    const onResolved = (records: MutationRecord[]): void => {
      for (const record of records) {
        if (record.type !== 'childList') continue
        for (const node of record.removedNodes) {
          if (node instanceof Element && containsPanel(node)) {
            focusRestore.restore()
            break
          }
        }
      }
    }
    // Batch mutations into one scan per animation frame: a busy session
    // mutates the chat DOM on every streamed token, and a full
    // `[data-approval-key]` query per mutation is wasted while no panel is
    // open. One frame-level scan covers any burst of changes.
    const scheduleScan = (): void => {
      if (scanFrame !== undefined) return
      scanFrame = requestAnimationFrame(() => {
        scanFrame = undefined
        scan(ctx, t)
      })
    }
    const start = (): void => {
      observer = new MutationObserver((records) => {
        onResolved(records)
        scheduleScan()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      scan(ctx, t)
    }
    const onReady = (): void => { start() }
    if (document.body !== null) start()
    else document.addEventListener('DOMContentLoaded', onReady, { once: true })

    yield () => {
      unbindEditRow()
      unbindBashRow()
      observer?.disconnect()
      if (scanFrame !== undefined) cancelAnimationFrame(scanFrame)
      document.removeEventListener('focusin', focusRestore.onFocusIn, true)
      document.removeEventListener('DOMContentLoaded', onReady)
      style.remove()
    }
  }, 'dsh-edit-approval client lifecycle')
}
