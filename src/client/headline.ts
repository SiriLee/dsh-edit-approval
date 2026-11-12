/**
 * Approval-panel headline locator.
 *
 * The panel renders the approval `reason` in a headline element inside its
 * scrollable body. That shape is **not** a documented contract, and it moves:
 *
 * - Through `0.2.1` the headline was the body's first element child.
 * - `0.2.2` wrapped it in a `.heading` row (`display: flex; align-items: center;
 *   flex-wrap: wrap`) that can also carry a warning chip, so a positional
 *   selector landed on the WRAPPER. Rows injected there became flex items laid
 *   out side by side and wrapped instead of stacked — the panel's line layout
 *   broke.
 *
 * So anchor on **content, not position**: the headline is the element owning a
 * direct text node that holds the reason. That is exactly the node carrying our
 * `\n` line breaks, and it survives any further wrapper the harness adds.
 *
 * Two rules follow from that and are easy to get wrong:
 *
 * - The lookup stays valid **after** a rebuild: once `renderDiffRows` has run,
 *   the first text node belongs to a rendered row, so the walk would find that
 *   row instead of the headline. The rows carry this plugin's own
 *   `dsh-ea-diff-*` classes, so their parent is the headline by construction.
 * - A panel with no rendered text yet yields `null`; there is nothing to
 *   enhance, and the mutation observer re-scans on the next mutation.
 *
 * Pure DOM helpers, no framework imports — unit-testable in jsdom.
 *
 * @module dsh-edit-approval/client/headline
 */

/** The approval panel root anchor (set by the harness panel root). */
export const PANEL_SELECTOR = '[data-approval-key]'

/** The panel's scrollable body seat (a stable data attribute, unlike class names). */
export const BODY_SELECTOR = '[data-approval-scroll]'

/** `NodeFilter.SHOW_TEXT`, spelled out so no DOM global is required. */
const SHOW_TEXT = 4

/**
 * Class prefix of the rows this plugin renders into the headline. Matched with
 * `*=` so a row keeps matching if another class is ever put on it.
 */
const ROW_PREFIX = 'dsh-ea-diff-'

/**
 * Locate the headline element of one approval panel.
 * @param panel - the `[data-approval-key]` panel root.
 * @returns The element holding the reason text, or `null` when the panel has no
 *   rendered text or only text seated directly in the body (which must not be
 *   replaced, because the body also owns the command row).
 */
export function findHeadline(panel: Element): HTMLElement | null {
  const body = panel.querySelector(BODY_SELECTOR)
  if (body === null) return null
  // Already rebuilt: our own rows are the headline's children.
  const row = body.querySelector(`[class*="${ROW_PREFIX}"]`)
  if (row !== null && row.parentElement !== null && row.parentElement !== body) return row.parentElement
  const doc = body.ownerDocument ?? document
  const walker = doc.createTreeWalker(body, SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.nodeValue ?? '').trim() === '') continue
    const element = (node as Text).parentElement
    // Text seated directly in the body is not a headline element: rebuilding it
    // would take the whole body with it. Keep looking for a deeper owner.
    if (element === null || element === body) continue
    return element
  }
  return null
}
