/**
 * dsh-edit-approval — browser half.
 *
 * Rebuilds the approval panel's diff headline as red/green per-line blocks
 * (the reason is plain text; per-line coloring is impossible without this)
 * and registers the edit-approval master switch into Settings → General.
 *
 * Pure DOM injection: no new page, no new popup — the panel's stable data
 * attribute is the only anchor. The tool name comes from the session's
 * pending approval payload (`session.getSnapshot().pending`), so the host
 * command receives the exact tool that is asking. All side effects are
 * registered as one `ctx.effect`, so plugin unload / HMR tears them down.
 *
 * @module dsh-edit-approval/client
 */

// Type-only: both are module-table words, never inlined; the runtime code
// below touches only the DOM and the session face.
import type { ClientContext, SessionFace, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings slot declaration ('settings.general.item') and
// the settingsScope Context merge (`ctx.settingsScope.bind`).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale service merge (`ctx.locale`) and the slot
// declaration; runtime copy comes from the locale dictionary below.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { EditApprovalRow } from './settings-row.tsx'
import { en, NS, zh, type EditApprovalKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The edit-approval Settings → General row copy. */
    'edit-approval': EditApprovalKey
  }
}

/** Stable plugin name. */
export const name = 'dsh-edit-approval/client'

/** Required services: sessions (pending approvals), slots (the settings row), locale (row copy), settingsScope (the row state). */
export const inject = ['sessions', 'slots', 'locale', 'settingsScope']

/** Settings shape of the `edit-approval` namespace (mirrors the host Config). */
interface EditApprovalSettings {
  enabled: boolean
  tools: string[]
  minDiffLines: number
  includeCreate: boolean
  includeDelete: boolean
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
 * one block per line — `+` lines green, `-` lines red, the rest muted —
 * plus a monospace font to read like a code diff. Purely additive DOM; the
 * panel is mounted once per approval and never re-renders the reason text,
 * so the replacement cannot be clobbered by React.
 */
const DIFF_STYLE = [
  '[data-approval-key] [data-approval-scroll] > div:first-child {',
  '  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);',
  '  font-size: 13px;',
  '  line-height: 20px;',
  '}',
  '[data-approval-key] .dsh-ea-diff-add { color: var(--dsw-alias-state-success-primary, #2f9e44); }',
  '[data-approval-key] .dsh-ea-diff-remove { color: var(--dsw-alias-state-error-primary, #e03131); }',
  '[data-approval-key] .dsh-ea-diff-context { color: var(--dsw-alias-label-tertiary, #868e96); }',
  '[data-approval-key] .dsh-ea-diff-ellipsis { color: var(--dsw-alias-label-tertiary, #868e96); opacity: .6; padding-left: 8px; }',
].join('\n')

/** The panel's headline seat (stable data-attribute anchor, same as PREWRAP). */
const HEADLINE_SELECTOR = '[data-approval-scroll] > div:first-child'

/**
 * Rebuild the headline: keep the header line (tool · file · stats), render
 * only the red/green changed lines, and mark every omitted run of grey
 * context lines with a "…" gap — a big edit stays compact without hiding
 * that rows were skipped. The host reason text stays complete; only this
 * presentation filters it.
 */
function renderDiffRows(headline: HTMLElement): void {
  const text = headline.textContent ?? ''
  if (!text.includes('\n')) return // single-line reason: leave it as-is
  headline.textContent = ''
  const lines = text.split('\n')
  const ellipsis = (): void => {
    const row = document.createElement('div')
    row.className = 'dsh-ea-diff-ellipsis'
    row.textContent = '…'
    headline.appendChild(row)
  }
  // Header line: keep as a muted title.
  const head = document.createElement('div')
  head.className = 'dsh-ea-diff-context'
  head.textContent = lines[0] ?? ''
  headline.appendChild(head)
  let lastRendered = 0
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!line.startsWith('+') && !line.startsWith('-')) continue // context omitted
    if (index > lastRendered + 1) ellipsis() // gap between rendered rows
    const row = document.createElement('div')
    row.className = line.startsWith('+') ? 'dsh-ea-diff-add' : 'dsh-ea-diff-remove'
    row.textContent = line
    headline.appendChild(row)
    lastRendered = index
  }
  // Trailing context after the last change: mark it too.
  if (lastRendered < lines.length - 1) ellipsis()
}

/** Panels already enhanced in this page lifetime. */
const enhanced = new WeakSet<Element>()

/** Whether a pending approval exists behind one panel key (the diff renders only for approvals). */
function hasPendingApproval(ctx: ClientContext, key: string): boolean {
  const ids = ctx.sessions.list.getSnapshot().ids
  for (const id of ids) {
    const binding = ctx.sessions.binding(id)
    if (binding === undefined) continue
    const pending = binding.session.getSnapshot().pending
    if (pending.some((item) => item.kind === 'approval' && item.key === key)) return true
  }
  return false
}

/** Rebuild the diff headline of one freshly rendered approval panel. */
function enhance(ctx: ClientContext, panel: Element): boolean {
  const key = panel.getAttribute('data-approval-key')
  if (key === null) return false
  if (!hasPendingApproval(ctx, key)) return false // pending not visible yet; a later mutation retries
  // Red/green diff: rebuild the plain-text headline into colored rows.
  const headline = panel.querySelector<HTMLElement>(HEADLINE_SELECTOR)
  if (headline !== null) renderDiffRows(headline)
  return true
}

/** Scan the document for approval panels that are not yet enhanced. */
function scan(ctx: ClientContext): void {
  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    if (enhanced.has(panel)) continue
    // Mark only on success so a panel whose pending approval is not yet
    // visible (transient) is retried on the next mutation.
    if (enhance(ctx, panel)) enhanced.add(panel)
  }
}

/** Resolve the current session face (the settings page opens within one). */
function currentSessionOf(ctx: ClientContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id === undefined ? undefined : ctx.sessions.binding(id)?.session
}

/**
 * Wait until the settings scope reports `enabled === expected`. The toggle
 * writes through the host `/approval-edit` command (reliable), and the host's
 * `settings.update` is pushed back to this scope; resolve once it lands, or
 * with the current value on timeout so the row never sticks on an optimistic
 * lie.
 */
function waitForEnabled(host: SettingsScope<EditApprovalSettings>, expected: boolean): Promise<boolean | null> {
  return new Promise((resolve) => {
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
      const value = host.getSnapshot().value?.enabled
      if (value === expected) settle(value ?? null)
    }
    const unsubscribe = host.subscribe(check)
    timer = setTimeout(() => settle(host.getSnapshot().value?.enabled ?? null), 4000)
    check()
  })
}

/**
 * Mount the browser half: inject the diff styles, register the
 * Settings → General master-switch row, and observe approval panels to
 * enhance them. Disposal unwinds everything.
 * @param ctx - client root context carrying `sessions`, `slots`.
 */
export function apply(ctx: ClientContext): void {
  // Locale dictionary: the Settings → General row copy follows the user's dsh
  // language preference. Registered once for the plugin's lifetime.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-edit-approval: locale dictionaries')

  // The row READS through the settings scope (no `/approval-edit status`
  // command into the chat) but WRITES through the host command — the route
  // that reliably persists. `settingsScope.set` never landed on the host for
  // this namespace, so the toggle must go through the command path.
  const host = ctx.settingsScope.bind<EditApprovalSettings>({ namespace: 'edit-approval' })

  ctx.effect(function* () {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-edit-approval'
    style.textContent = `${PREWRAP_STYLE}\n${DIFF_STYLE}`
    document.head.appendChild(style)

    // Settings → General row: the edit-approval master switch. `locale: NS`
    // synthesizes the `t` seat on the row's props.
    const unbindRow = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'edit-approval',
      order: 30,
      locale: NS,
      inject: () => ({
        getStatus: () => Promise.resolve(host.getSnapshot().value?.enabled ?? null),
        toggle: async (next: boolean): Promise<boolean | null> => {
          const session = currentSessionOf(ctx)
          if (session === undefined) return null
          // Write through the host command (the handler returns no text, so
          // nothing surfaces in the chat); then settle on the pushed-back value.
          await session.command(`/approval-edit ${next ? 'on' : 'off'}`)
          return await waitForEnabled(host, next)
        },
      }),
    }, EditApprovalRow))

    let observer: MutationObserver | undefined
    let scanFrame: number | undefined
    // Batch mutations into one scan per animation frame: a busy session
    // mutates the chat DOM on every streamed token, and a full
    // `[data-approval-key]` query per mutation is wasted while no panel is
    // open. One frame-level scan covers any burst of changes.
    const scheduleScan = (): void => {
      if (scanFrame !== undefined) return
      scanFrame = requestAnimationFrame(() => {
        scanFrame = undefined
        scan(ctx)
      })
    }
    const start = (): void => {
      observer = new MutationObserver(() => { scheduleScan() })
      observer.observe(document.body, { childList: true, subtree: true })
      scan(ctx)
    }
    const onReady = (): void => { start() }
    if (document.body !== null) start()
    else document.addEventListener('DOMContentLoaded', onReady, { once: true })

    yield () => {
      unbindRow()
      observer?.disconnect()
      if (scanFrame !== undefined) cancelAnimationFrame(scanFrame)
      document.removeEventListener('DOMContentLoaded', onReady)
      style.remove()
    }
  }, 'dsh-edit-approval client lifecycle')
}
