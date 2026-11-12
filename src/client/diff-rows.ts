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
 * Marker class added to a rebuilt headline; the diff's font rules hang off it.
 *
 * The name deliberately avoids the `dsh-ea-diff-` row prefix: `findHeadline`
 * looks for a row by that prefix, and a headline carrying it would be mistaken
 * for one of its own rows after a rebuild.
 *
 * It has to sit on the HEADLINE element, not on an ancestor: the panel's own
 * `.headline` rule sets `font-size: 15px; line-height: 24px; font-weight: 500`,
 * and a direct rule on an element always beats a value inherited from an
 * ancestor. Styling the scroll body therefore left the diff at the panel's
 * headline size — visibly larger than the 13px/monospace this plugin renders.
 */
export const DIFF_HEADLINE_CLASS = 'dsh-ea-headline'

/**
 * The diff's stylesheet: the code font on the rebuilt headline, plus one colour
 * per row role. Scoped by the caller's panel selector and kind marker so the diff
 * look never leaks onto other approval kinds.
 *
 * The font rule targets the HEADLINE, not an ancestor: the panel's own
 * `.headline` rule sets `font-size: 15px; line-height: 24px`, and a direct rule
 * on an element always beats a value inherited from an ancestor.
 * @param panel - selector matching the panel root that carries the kind class.
 * @param kind - the kind marker class that identifies diff panels.
 * @returns CSS text for a `<style>` element.
 */
export function diffRowsStyle(panel: string, kind: string): string {
  const scope = `${panel}.${kind}`
  return [
    `${scope} .${DIFF_HEADLINE_CLASS} {`,
    '  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);',
    '  font-size: 13px;',
    '  line-height: 20px;',
    '}',
    `${scope} .dsh-ea-diff-add { color: var(--dsw-alias-state-success-primary, #2f9e44); }`,
    `${scope} .dsh-ea-diff-remove { color: var(--dsw-alias-state-error-primary, #e03131); }`,
    `${scope} .dsh-ea-diff-context { color: var(--dsw-alias-label-tertiary, #868e96); }`,
    `${scope} .dsh-ea-diff-ellipsis { color: var(--dsw-alias-label-tertiary, #868e96); opacity: .6; padding-left: 8px; }`,
  ].join('\n')
}

/**
 * Whether an approval reason is a real line diff: it carries numbered change
 * rows (`   15| +XI-EDITED`). Edit approvals always do; the bash-approval
 * reason is plain text (header + `$ command` [+ flags]) and must NOT go
 * through {@link renderDiffRows} — the rebuild would treat its non-diff lines
 * as skipped context and collapse the command itself into an ellipsis.
 */
export function isDiffReason(text: string): boolean {
  return /\n\s*\d+\| [+-]/.test(text)
}

/**
 * Rebuild the headline: keep the header line (tool · file · stats) as a muted
 * title, then render the number-first change rows with their role color.
 * Context rows, ` ⋯` hunk gaps and the capped tail carry no `+`/`-` marker
 * and are omitted, with an ellipsis marking each skipped run between rendered
 * rows. Purely additive DOM; the panel is mounted once per approval and never
 * re-renders the reason text, so the replacement cannot be clobbered by
 * React. Only call this when {@link isDiffReason} is true.
 */
export function renderDiffRows(headline: HTMLElement): void {
  const text = headline.textContent ?? ''
  if (!text.includes('\n')) return // single-line reason: leave it as-is
  headline.textContent = ''
  headline.classList.add(DIFF_HEADLINE_CLASS)
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
