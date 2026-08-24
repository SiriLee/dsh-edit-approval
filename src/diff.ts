/**
 * Line-level diff used for the edit-approval preview.
 *
 * Pure functions only: no I/O, no framework imports — unit-testable in
 * isolation. The diff is computed with jsdiff's `structuredPatch` — the same
 * reference implementation the harness's write/edit result cards use
 * (`@deepseek-ai/dsh-tool-fs`), with the same 3-line context window — so the
 * approval preview and the post-approval result card derive from the same
 * algorithm. Each unified-diff hunk line carries its own role (` ` context,
 * `-` removed, `+` added), which this module maps onto the `+`/`-`/` `
 * prefixed lines shown in the approval panel headline, with exact 1-based
 * line numbers from the hunk start lines and a `⋯` gap row between hunks.
 *
 * @module dsh-edit-approval/diff
 */

import { structuredPatch } from 'diff'

export type DiffLineType = 'add' | 'remove' | 'context' | 'gap'

/** One aligned line of the diff. */
export interface DiffLine {
  readonly type: DiffLineType
  readonly text: string
  /** 1-based original line number; present on remove/context lines. */
  readonly oldLine?: number
  /** 1-based new line number; present on add/context lines. */
  readonly newLine?: number
}

/**
 * A `gap` line marks the unchanged run between two separate hunks (rendered
 * as `⋯`). jsdiff already merges hunks whose context windows would overlap,
 * so a gap row appears only where lines are genuinely skipped.
 */

/**
 * Context lines shown on each side of an applied hunk. Mirrors
 * `@deepseek-ai/dsh-tool-fs`'s `DIFF_CONTEXT`, so the preview's context
 * window matches the harness diff card exactly.
 */
export const DIFF_CONTEXT = 3

/**
 * Normalize CRLF line endings to LF before diffing. The comparison basis is
 * LF (the harness fs layer's diff basis); normalizing both sides keeps a
 * line-ending-style-only difference from reading as a whole-file rewrite.
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/**
 * Compute a line-level diff between two texts. Line roles and 1-based line
 * numbers come straight from the unified-diff hunks (`oldStart`/`newStart`
 * per hunk), so they are exact rather than derived. Identical texts yield an
 * empty diff (no hunks); a trailing-newline-only change yields a real
 * `-`/`+` pair instead of a phantom empty line.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const patch = structuredPatch(
    '', '',
    normalizeLineEndings(oldText), normalizeLineEndings(newText),
    undefined, undefined,
    { context: DIFF_CONTEXT },
  )
  const out: DiffLine[] = []
  for (let h = 0; h < patch.hunks.length; h += 1) {
    if (h > 0) out.push({ type: 'gap', text: '⋯' })
    const hunk = patch.hunks[h]!
    let oldIdx = hunk.oldStart
    let newIdx = hunk.newStart
    for (const raw of hunk.lines) {
      const ch = raw.charAt(0)
      // The unified-diff marker for a missing trailing newline annotates the
      // patch, not the content — skip it so it never leaks into the diff.
      if (ch === '\\') continue
      const text = raw.slice(1)
      if (ch === ' ') {
        out.push({ type: 'context', text, oldLine: oldIdx++, newLine: newIdx++ })
      } else if (ch === '-') {
        out.push({ type: 'remove', text, oldLine: oldIdx++ })
      } else if (ch === '+') {
        out.push({ type: 'add', text, newLine: newIdx++ })
      }
    }
  }
  return out
}

/** Default prefix markers: add is green (`+`), remove is red (`-`), context grey (` `), hunk gap (`⋯`). */
export const DEFAULT_PREFIX: Readonly<Record<DiffLineType, string>> = {
  add: '+',
  remove: '-',
  context: ' ',
  gap: ' ',
}

export interface DiffRenderOptions {
  /** Per-type prefix; missing types fall back to {@link DEFAULT_PREFIX}. */
  readonly prefix?: Readonly<Partial<Record<DiffLineType, string>>>
  /** Cap on emitted lines; the tail is summarized with "… N more lines". 0 = no cap. */
  readonly maxLines?: number
  /** Prefix 1-based line numbers (old for removals, new for additions, both for context). */
  readonly lineNumbers?: boolean
}

/**
 * Render a diff as multi-line text for the approval reason. Long diffs are
 * capped (default 500 lines) so the panel stays scannable; the approval
 * panel body scrolls, so a large edit is still reviewable in parts.
 */
export function renderDiff(diff: readonly DiffLine[], options: DiffRenderOptions = {}): string {
  const maxLines = options.maxLines ?? 500
  const lineNumbers = options.lineNumbers ?? false
  const total = diff.length
  const shown = maxLines > 0 ? Math.min(total, maxLines) : total
  // Right-aligned line-number gutter: at least 5 wide, growing to fit the
  // largest line number in the diff so the `|` column stays aligned.
  let numberWidth = 5
  if (lineNumbers) {
    let max = 0
    for (const line of diff) {
      if (line.oldLine !== undefined && line.oldLine > max) max = line.oldLine
      if (line.newLine !== undefined && line.newLine > max) max = line.newLine
    }
    numberWidth = Math.max(5, String(max).length)
  }
  const lines: string[] = []
  for (let k = 0; k < shown; k += 1) {
    const line = diff[k]!
    let head = options.prefix?.[line.type] ?? DEFAULT_PREFIX[line.type]
    if (lineNumbers) {
      if (line.type === 'add') {
        head = `${String(line.newLine ?? '').padStart(numberWidth)}| ${head}`
      } else if (line.type === 'remove') {
        head = `${String(line.oldLine ?? '').padStart(numberWidth)}| ${head}`
      } else if (line.type === 'context') {
        // `old:new` with no `|`; the panel skips context rows, and the colon
        // keeps them distinct from the change rows' `NN|` gutter.
        head = `${String(line.oldLine ?? '')}:${String(line.newLine ?? '')} `
      }
      // 'gap' rows carry no line numbers — the prefix alone marks them.
    }
    lines.push(head + line.text)
  }
  if (total > shown) {
    lines.push(`… ${total - shown} more line${total - shown === 1 ? '' : 's'} …`)
  }
  return lines.join('\n')
}

/** Number of changed lines (additions + removals); context and gap rows do not count. */
export function countChangedLines(diff: readonly DiffLine[]): number {
  let changed = 0
  for (const line of diff) {
    if (line.type === 'add' || line.type === 'remove') changed += 1
  }
  return changed
}

/** Count of added lines, for the summary header. */
export function countInsertions(diff: readonly DiffLine[]): number {
  let count = 0
  for (const line of diff) {
    if (line.type === 'add') count += 1
  }
  return count
}

/** Count of removed lines, for the summary header. */
export function countDeletions(diff: readonly DiffLine[]): number {
  let count = 0
  for (const line of diff) {
    if (line.type === 'remove') count += 1
  }
  return count
}
