/**
 * dsh-edit-approval — browser half.
 *
 * Injects a third "always allow" action into the existing approval panel
 * (`[data-approval-key]`, the composer-takeover ApprovalPanel). Clicking it
 * ① clicks the panel's existing "allow once" button (this run proceeds) and
 * ② runs `/approval-always <tool>` so the tool stops asking.
 *
 * Pure DOM injection: no new page, no new popup, no React — the panel's
 * stable data attribute is the only anchor. The tool name comes from the
 * session's pending approval payload (`session.getSnapshot().pending`), so
 * the host command receives the exact tool that is asking.
 *
 * @module dsh-edit-approval/client
 */

// Type-only: both are module-table words, never inlined; the runtime code
// below touches only the DOM and the session face.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'

/** Stable plugin name. */
export const name = 'dsh-edit-approval/client'

/** The approval panel root anchor (set by ApprovalPanel.tsx). */
const PANEL_SELECTOR = '[data-approval-key]'

/** Attribute marking our injected button. */
const ALWAYS_ALLOW_ATTR = 'data-dsh-edit-approval-always'

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
  // Panel layout is reject, then allow-once — the allow-once button is last.
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
  actionRow.appendChild(button)
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

/** Mount the browser half: observe the document and enhance every approval panel. */
export function apply(ctx: ClientContext): void {
  const start = (): void => {
    const observer = new MutationObserver(() => { scan(ctx) })
    observer.observe(document.body, { childList: true, subtree: true })
    scan(ctx)
  }
  if (document.body !== null) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
