/**
 * dsh-edit-approval — browser half.
 *
 * ① Injects a third "always allow" action into the existing approval panel
 *    (`[data-approval-key]`, the composer-takeover ApprovalPanel). Clicking
 *    it ① clicks the panel's existing "allow once" button (this run
 *    proceeds) and ② runs `/approval-always <tool>` so the tool stops asking.
 * ② Rebuilds the panel's diff headline as red/green per-line blocks (the
 *    reason is plain text; per-line coloring is impossible without this).
 * ③ Registers the edit-approval master switch into Settings → General.
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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings slot declaration ('settings.general.item').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { EditApprovalRow } from './settings-row.tsx'

/** Stable plugin name. */
export const name = 'dsh-edit-approval/client'

/** Required services: sessions (pending approvals), slots + settingsScope (the settings row). */
export const inject = ['sessions', 'slots', 'settingsScope']

/** The approval panel root anchor (set by ApprovalPanel.tsx). */
const PANEL_SELECTOR = '[data-approval-key]'

/** Attribute marking our injected button. */
const ALWAYS_ALLOW_ATTR = 'data-dsh-edit-approval-always'

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
].join('\n')

/** The panel's headline seat (stable data-attribute anchor, same as PREWRAP). */
const HEADLINE_SELECTOR = '[data-approval-scroll] > div:first-child'

/** Rebuild one headline's text into colored per-line blocks (red/green diff). */
function renderDiffRows(headline: HTMLElement): void {
  const text = headline.textContent ?? ''
  if (!text.includes('\n')) return // single-line reason: leave it as-is
  headline.textContent = ''
  for (const line of text.split('\n')) {
    const row = document.createElement('div')
    row.className = line.startsWith('+')
      ? 'dsh-ea-diff-add'
      : line.startsWith('-')
        ? 'dsh-ea-diff-remove'
        : 'dsh-ea-diff-context'
    row.textContent = line
    headline.appendChild(row)
  }
}

/** Panels already enhanced in this page lifetime. */
const enhanced = new WeakSet<Element>()

/** Bilingual label for the injected action. */
function alwaysAllowLabel(): string {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')
    ? '总是允许'
    : 'Always allow'
}

/** Find the session face and tool name behind one pending approval key. */
function resolveApproval(ctx: ClientContext, key: string): { session: SessionFace; toolName: string } | undefined {
  const ids = ctx.sessions.list.getSnapshot().ids
  for (const id of ids) {
    const binding = ctx.sessions.binding(id)
    if (binding === undefined) continue
    const session = binding.session
    const pending = session.getSnapshot().pending
    for (const item of pending) {
      if (item.kind === 'approval' && item.key === key) {
        return { session, toolName: item.payload.toolName }
      }
    }
  }
  return undefined
}

/** Inject the always-allow action into one freshly rendered approval panel. */
function enhance(ctx: ClientContext, panel: Element): boolean {
  const key = panel.getAttribute('data-approval-key')
  if (key === null) return false
  const match = resolveApproval(ctx, key)
  if (match === undefined) return false // pending not visible yet; a later mutation retries
  const buttons = Array.from(panel.querySelectorAll('button'))
  // The panel renders exactly two actions — reject first, then allow-once
  // (ApprovalPanel.tsx: `<Button variant="outline">` reject, `<Button
  // variant="primary">` allow-once). The allow-once button is therefore the
  // last one; if the panel ever grows more actions, match by data attribute
  // instead of relying on this order.
  const allowOnce = buttons[buttons.length - 1]
  if (allowOnce === undefined) return false
  const actionRow = allowOnce.parentElement
  if (actionRow === null) return false

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = alwaysAllowLabel()
  button.setAttribute(ALWAYS_ALLOW_ATTR, '')
  // Modest outline capsule matching the panel's action row.
  button.style.cssText = [
    'border:1px solid var(--dsw-alias-state-warn-secondary, rgba(180,130,20,.6))',
    'background:transparent',
    'color:var(--dsw-alias-label-primary, inherit)',
    'border-radius:9999px',
    'padding:4px 14px',
    'font:inherit',
    'font-size:13px',
    'line-height:20px',
    'cursor:pointer',
  ].join(';')
  button.addEventListener('click', () => {
    button.disabled = true
    // ① This run proceeds exactly as if "allow once" was clicked.
    allowOnce.click()
    // ② Persist the always-allow entry on the host.
    void match.session.command(`/approval-always ${match.toolName}`).catch((error: unknown) => {
      console.warn(`dsh-edit-approval: /approval-always ${match.toolName} failed: ${String(error)}`)
    })
  })
  // Place the always-allow action between reject and allow-once, so the
  // panel reads 拒绝 | 总是允许 | 同意. allow-once stays the LAST button,
  // which the allow-once lookup above relies on.
  actionRow.insertBefore(button, allowOnce)

  // Red/green diff: rebuild the plain-text headline into colored rows.
  const headline = panel.querySelector<HTMLElement>(HEADLINE_SELECTOR)
  if (headline !== null) renderDiffRows(headline)

  return true
}

/**
 * Approve with the keyboard: while an approval panel is on screen, Enter
 * clicks its allow-once action (the panel occupies the composer, so no text
 * input is in play; the target guard keeps accidental fires out of inputs).
 */
function bindEnterToApprove(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.key !== 'Enter') return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    const panel = document.querySelector<HTMLElement>(PANEL_SELECTOR)
    if (panel === null) return
    const buttons = panel.querySelectorAll('button')
    const allowOnce = buttons[buttons.length - 1]
    if (allowOnce instanceof HTMLButtonElement && !allowOnce.disabled) allowOnce.click()
  }
  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
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

/** Settings namespace backing the master switch (must match the host). */
const SETTINGS_NAMESPACE = 'edit-approval'

/** The namespace value shape (subset used by the settings row). */
interface EditApprovalSettingsValue {
  enabled: boolean
}

/**
 * Mount the browser half: inject the diff styles, register the
 * Settings → General master-switch row, observe approval panels and enhance
 * them, and bind the Enter-to-approve shortcut. Disposal unwinds everything.
 * @param ctx - client root context carrying `sessions`, `slots`, `settingsScope`.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(function* () {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-edit-approval'
    style.textContent = `${PREWRAP_STYLE}\n${DIFF_STYLE}`
    document.head.appendChild(style)

    // Settings → General row: the edit-approval master switch. The custom
    // decode trusts the host-resolved value as-is: the default schema
    // rehydration + validation path can reject our wire schema (arrays with
    // defaults), which would leave the snapshot value unpublished and the
    // toggle permanently unchecked despite a healthy host side.
    const scope = ctx.settingsScope.bind<EditApprovalSettingsValue>({
      namespace: SETTINGS_NAMESPACE,
      decode: (value) => value as EditApprovalSettingsValue,
    })
    const unbindRow = ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'edit-approval',
      order: 30,
      inject: () => ({
        getSnapshot: () => scope.getSnapshot().value?.enabled ?? true,
        subscribe: (cb: () => void) => scope.subscribe(cb),
        toggle: (next: boolean) => {
          // Load first so the write carries the LATEST revision: the host
          // command path (/approval-always, /approval-edit) also writes this
          // namespace, and a stale expectedRevision makes the host reject the
          // mutate with a conflict. Load again after the write so the row
          // reflects the host value even if the document-updated event bridge
          // did not reach this page. (load is on the concrete controller, not
          // the SettingsScope contract — hence the cast.)
          const refresh = (scope as unknown as { load(): Promise<void> }).load
          void (async () => {
            try {
              await refresh()
              await scope.set('enabled', next)
              await refresh()
            } catch (error) {
              console.warn(`dsh-edit-approval: settings toggle failed: ${String(error)}`)
            }
          })()
        },
      }),
    }, EditApprovalRow))

    let observer: MutationObserver | undefined
    const start = (): void => {
      observer = new MutationObserver(() => { scan(ctx) })
      observer.observe(document.body, { childList: true, subtree: true })
      scan(ctx)
    }
    const onReady = (): void => { start() }
    if (document.body !== null) start()
    else document.addEventListener('DOMContentLoaded', onReady, { once: true })

    const unbindEnter = bindEnterToApprove()

    yield () => {
      unbindEnter()
      unbindRow()
      observer?.disconnect()
      document.removeEventListener('DOMContentLoaded', onReady)
      style.remove()
    }
  }, 'dsh-edit-approval client lifecycle')
}
