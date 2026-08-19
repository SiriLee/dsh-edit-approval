/**
 * Approval-panel collapse button.
 *
 * Pure DOM helpers, no framework imports — unit-testable in jsdom. The
 * harness ApprovalPanel body (`[data-approval-scroll]`: the red/green diff
 * headline plus the optional command line) can be hundreds of lines tall and
 * hides the agent's output behind the composer. This module installs a
 * disclosure button at the strip's right end (the card's top-right corner)
 * that toggles the body visibility via a card class — CSS-only show/hide,
 * the diff DOM stays intact, so expanding restores the exact same view with
 * no re-render.
 *
 * @module dsh-edit-approval/client/collapse
 */

/** Card class toggled by the collapse button (the body-hiding rule lives in {@link COLLAPSE_STYLE}). */
export const COLLAPSED_CLASS = 'dsh-ea-collapsed'

/** Class of the injected disclosure button. */
export const COLLAPSE_BUTTON_CLASS = 'dsh-ea-collapse-btn'

/** Per-panel `aria-controls` id prefix for the scrollable body. */
const BODY_ID_PREFIX = 'dsh-ea-body-'

/** The scrollable body seat (the same structural anchor the diff rendering uses). */
const BODY_SELECTOR = '[data-approval-scroll]'

/** Counter fallback when a panel carries no usable `data-approval-key`. */
let autoBodyId = 0

/**
 * The harness `IconChevronDownOutline14` path (14×14, `fill: currentColor`),
 * inlined so the injected button matches the native icon style. The raw icon
 * points down, matching the harness disclosure convention (open rows show
 * the down chevron): expanded shows it unrotated (▾), collapsed rotates it
 * 180° (▴).
 */
const CHEVRON_DOWN_PATH =
  'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'

/** Inline chevron-down SVG (presentational; the button carries the accessible label). */
const CHEVRON_SVG = [
  '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">',
  `<path d="${CHEVRON_DOWN_PATH}" fill="currentColor"/>`,
  '</svg>',
].join('')

/**
 * Collapse-button styling plus the body-hiding rule. Scoped by the panel
 * root anchor and the card class, so it never leaks outside an approval
 * panel. Merged into the plugin's injected `<style>` by `index.ts`.
 */
export const COLLAPSE_STYLE = [
  `[data-approval-key] .${COLLAPSE_BUTTON_CLASS} {`,
  '  margin-left: auto; flex: none;',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  width: 22px; height: 22px; padding: 0;',
  '  border: none; border-radius: 6px; background: transparent;',
  '  color: var(--dsw-alias-state-warn-primary, #f08c00); cursor: pointer;',
  '}',
  `[data-approval-key] .${COLLAPSE_BUTTON_CLASS}:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); }`,
  `[data-approval-key] .${COLLAPSE_BUTTON_CLASS}:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-border-l3, rgba(0, 0, 0, .2)); }`,
  `[data-approval-key] .${COLLAPSE_BUTTON_CLASS} svg { width: 14px; height: 14px; transform: rotate(0deg); transition: transform .12s; }`,
  `[data-approval-key].${COLLAPSED_CLASS} .${COLLAPSE_BUTTON_CLASS} svg { transform: rotate(180deg); }`,
  `[data-approval-key].${COLLAPSED_CLASS} [data-approval-scroll] { display: none; }`,
].join('\n')

/** Action labels for the disclosure button (resolved through the locale service). */
export interface CollapseLabels {
  /** Label shown while expanded ("collapse approval details"). */
  readonly collapse: string
  /** Label shown while collapsed ("expand approval details"). */
  readonly expand: string
}

/**
 * Install the collapse button on one approval panel. No-op unless the
 * headline is multi-line (a real diff — single-line escalation approvals
 * keep the native compact panel) and the button is not already installed.
 * The button lives at the strip's right end; clicking toggles the
 * `dsh-ea-collapsed` class on the panel root, flips `aria-expanded` and the
 * action label, and leaves the diff DOM untouched.
 * @param panel - the `[data-approval-key]` panel root.
 * @param labels - localized button labels.
 */
export function installCollapseButton(panel: Element, labels: CollapseLabels): void {
  if (panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`) !== null) return // idempotent
  const body = panel.querySelector<HTMLElement>(BODY_SELECTOR)
  if (body === null) return
  const headline = body.firstElementChild
  // A diff is present either before the headline rebuild (raw text still
  // carries `\n`) or after it (the rebuild splits the text into row divs, so
  // the concatenated textContent has no newlines — but the headline then has
  // >1 child). Single-line escalation approvals have neither, so they keep
  // the native compact panel.
  const multiLine = (headline?.children.length ?? 0) > 1 || (headline?.textContent ?? '').includes('\n')
  if (!multiLine) return
  const strip = panel.firstElementChild?.firstElementChild
  if (strip === null || strip === undefined) return

  // Stable per-panel id for `aria-controls` (keyed by the approval key).
  const key = (panel.getAttribute('data-approval-key') ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  body.id = body.id || `${BODY_ID_PREFIX}${key || `auto-${autoBodyId++}`}`

  const button = document.createElement('button')
  button.type = 'button'
  button.className = COLLAPSE_BUTTON_CLASS
  button.setAttribute('aria-expanded', 'true')
  button.setAttribute('aria-controls', body.id)
  button.setAttribute('aria-label', labels.collapse)
  button.title = labels.collapse
  button.innerHTML = CHEVRON_SVG
  button.addEventListener('click', () => {
    const collapsed = panel.classList.toggle(COLLAPSED_CLASS)
    const label = collapsed ? labels.expand : labels.collapse
    button.setAttribute('aria-expanded', String(!collapsed))
    button.setAttribute('aria-label', label)
    button.title = label
  })
  strip.appendChild(button)
}
