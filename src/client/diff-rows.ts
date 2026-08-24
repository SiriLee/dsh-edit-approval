/**
 * Approval-panel diff headline rebuild.
 *
 * The harness ApprovalPanel headlines the `reason` text in `.headline`; the
 * plugin rebuilds that plain-text diff into per-line rows. The host emits a
 * flat text format — header line, then ` `/`-`/`+` prefixed lines carrying a
 * 3-line context window with exact line numbers, and a ` ⋯` gap row between
 * hunks — so this module only maps prefixes to row classes: context grey,
 * removals red, additions green, hunk gaps dim. Pure DOM helpers, no
 * framework imports — unit-testable in jsdom.
 *
 * @module dsh-edit-approval/client/diff-rows
 */

/** The gap row's rendered text (emitted by the host between hunks). */
export const GAP_MARKER = '⋯'

/**
 * Rebuild the headline: keep the header line (tool · file · stats) as a muted
 * title, then render every diff line with its role color. Every emitted line
 * is rendered — the host already bounds context to 3 lines per hunk and marks
 * skipped runs with `⋯` — so nothing is dropped and no ellipsis inference is
 * needed. Purely additive DOM; the panel is mounted once per approval and
 * never re-renders the reason text, so the replacement cannot be clobbered by
 * React.
 */
export function renderDiffRows(headline: HTMLElement): void {
  const text = headline.textContent ?? ''
  if (!text.includes('\n')) return // single-line reason: leave it as-is
  headline.textContent = ''
  const lines = text.split('\n')
  // Header line: keep as a muted title.
  const head = document.createElement('div')
  head.className = 'dsh-ea-diff-context'
  head.textContent = lines[0] ?? ''
  headline.appendChild(head)
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!
    const row = document.createElement('div')
    if (line.startsWith('+')) {
      row.className = 'dsh-ea-diff-add'
    } else if (line.startsWith('-')) {
      row.className = 'dsh-ea-diff-remove'
    } else if (line.trim() === GAP_MARKER) {
      row.className = 'dsh-ea-diff-ellipsis'
    } else {
      // Context lines (the host's 3-line window) render grey.
      row.className = 'dsh-ea-diff-context'
    }
    row.textContent = line
    headline.appendChild(row)
  }
}
