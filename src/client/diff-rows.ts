/**
 * Approval-panel diff headline rebuild.
 *
 * The harness ApprovalPanel headlines the `reason` text in `.headline`; the
 * plugin rebuilds that plain-text diff into per-line rows. The host emits a
 * flat text format — header line, then change rows with a right-aligned line
 * number, `|`, and `+content` / `-content` (e.g. `   15| +XI-EDITED`),
 * context rows (`old:new content`), and a ` ⋯` gap row between hunks. This
 * module renders ONLY the changed rows — removals red, additions green — and
 * marks every skipped run (context, hunk gaps) with a `…` ellipsis, so a big
 * edit stays compact. Pure DOM helpers, no framework imports — unit-testable
 * in jsdom.
 *
 * @module dsh-edit-approval/client/diff-rows
 */

/**
 * Rebuild the headline: keep the header line (tool · file · stats) as a muted
 * title, then render the number-first change rows with their role color.
 * Context rows, ` ⋯` hunk gaps and the capped tail carry no `+`/`-` marker
 * and are omitted, with an ellipsis marking each skipped run between rendered
 * rows. Purely additive DOM; the panel is mounted once per approval and never
 * re-renders the reason text, so the replacement cannot be clobbered by
 * React.
 */
export function renderDiffRows(headline: HTMLElement): void {
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
  // A change row is a right-aligned line number, `|`, then `+content` /
  // `-content` (e.g. `   15| +XI-EDITED`). The `old:new` colon on context
  // rows keeps them from matching, so a context line whose text starts with
  // `-` is never misread as a removal.
  let lastRendered = 0
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!
    const match = /^\s*(\d+)\| ([+-])/.exec(line)
    if (match === null) continue // context / hunk gap / capped tail: omitted
    if (index > lastRendered + 1) ellipsis() // skipped run before this change
    const row = document.createElement('div')
    row.className = match[2] === '+' ? 'dsh-ea-diff-add' : 'dsh-ea-diff-remove'
    row.textContent = line
    headline.appendChild(row)
    lastRendered = index
  }
  // Trailing context after the last change: mark it too.
  if (lastRendered < lines.length - 1) ellipsis()
}
