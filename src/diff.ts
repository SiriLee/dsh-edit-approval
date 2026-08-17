/**
 * Line-level diff used for the edit-approval preview.
 *
 * Pure functions only: no I/O, no framework imports — unit-testable in
 * isolation. The diff is a line-granular LCS alignment between the current
 * file content and the proposed content, rendered as `+`/`-`/` ` prefixed
 * lines (the "red/green line markers" shown in the approval panel headline).
 *
 * @module dsh-edit-approval/diff
 */

export type DiffLineType = 'add' | 'remove' | 'context'

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
 * LCS DP cells above this cap fall back to a whole-file replacement diff
 * (all old lines removed, all new lines added). The fallback is still a
 * correct diff — just coarser — and keeps a pathological 10k×10k file from
 * stalling the approval prompt. ~2000×2000 = 4M cells ≈ 16 MiB.
 */
export const MAX_LCS_CELLS = 4_000_000

/** Split text into lines; empty text has zero lines, a trailing newline yields a final empty line. */
export function splitLines(text: string): string[] {
  if (text.length === 0) return []
  return text.split(/\r?\n/)
}

/**
 * Compute a line-level diff between two texts (CRLF is normalized for the
 * comparison; the emitted line text keeps its original bytes).
 *
 * Equal head/tail runs are trimmed before the LCS so the alignment (and its
 * overflow fallback) only ever sees the changed middle — a one-line edit in a
 * 5000-line file diffs two tiny middles instead of a 25M-cell table or a
 * whole-file dump. Trimming only removes lines that are identical at both
 * boundaries, which any optimal alignment would mark as context anyway.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  return diffTextArrays(splitLines(oldText), splitLines(newText))
}

/** Align two line arrays, trimming identical head/tail lines off first. */
function diffTextArrays(oldLines: readonly string[], newLines: readonly string[]): DiffLine[] {
  const n = oldLines.length
  const m = newLines.length
  let head = 0
  while (head < n && head < m && oldLines[head] === newLines[head]) head += 1
  let tail = 0
  while (head + tail < n && head + tail < m && oldLines[n - 1 - tail] === newLines[m - 1 - tail]) tail += 1
  const out: DiffLine[] = []
  for (let i = 0; i < head; i += 1) {
    out.push({ type: 'context', text: oldLines[i]!, oldLine: i + 1, newLine: i + 1 })
  }
  for (const line of diffLineArrays(oldLines.slice(head, n - tail), newLines.slice(head, m - tail))) {
    out.push({
      type: line.type,
      text: line.text,
      ...line.oldLine !== undefined ? { oldLine: line.oldLine + head } : {},
      ...line.newLine !== undefined ? { newLine: line.newLine + head } : {},
    })
  }
  for (let i = 0; i < tail; i += 1) {
    const oldIdx = n - tail + i
    const newIdx = m - tail + i
    out.push({ type: 'context', text: oldLines[oldIdx]!, oldLine: oldIdx + 1, newLine: newIdx + 1 })
  }
  return out
}

/** Whole-file replacement alignment (the overflow fallback). */
function wholeReplace(oldLines: readonly string[], newLines: readonly string[]): DiffLine[] {
  const out: DiffLine[] = []
  for (let i = 0; i < oldLines.length; i += 1) {
    out.push({ type: 'remove', text: oldLines[i]!, oldLine: i + 1 })
  }
  for (let j = 0; j < newLines.length; j += 1) {
    out.push({ type: 'add', text: newLines[j]!, newLine: j + 1 })
  }
  return out
}

/** LCS-based line alignment with backtracking over the full length table. */
export function diffLineArrays(oldLines: readonly string[], newLines: readonly string[]): DiffLine[] {
  const n = oldLines.length
  const m = newLines.length
  if (n * m > MAX_LCS_CELLS) return wholeReplace(oldLines, newLines)
  if (n === 0) return newLines.map((text, j) => ({ type: 'add', text, newLine: j + 1 }))
  if (m === 0) return oldLines.map((text, i) => ({ type: 'remove', text, oldLine: i + 1 }))

  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = 1; i <= n; i += 1) {
    const oldLine = oldLines[i - 1]!
    for (let j = 1; j <= m; j += 1) {
      const idx = i * width + j
      if (oldLine === newLines[j - 1]!) {
        table[idx] = table[(i - 1) * width + (j - 1)]! + 1
      } else {
        const up = table[(i - 1) * width + j]!
        const left = table[i * width + (j - 1)]!
        table[idx] = up >= left ? up : left
      }
    }
  }

  const out: DiffLine[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const oldLine = oldLines[i - 1]!
    const newLine = newLines[j - 1]!
    if (oldLine === newLine) {
      out.push({ type: 'context', text: oldLine, oldLine: i, newLine: j })
      i -= 1
      j -= 1
    } else if (table[(i - 1) * width + j]! > table[i * width + (j - 1)]!) {
      // Remove-before-add on ties keeps a replaced line reading "-old / +new".
      out.push({ type: 'remove', text: oldLine, oldLine: i })
      i -= 1
    } else {
      out.push({ type: 'add', text: newLine, newLine: j })
      j -= 1
    }
  }
  while (i > 0) {
    out.push({ type: 'remove', text: oldLines[i - 1]!, oldLine: i })
    i -= 1
  }
  while (j > 0) {
    out.push({ type: 'add', text: newLines[j - 1]!, newLine: j })
    j -= 1
  }
  return out.reverse()
}

/** Default prefix markers: add is green (`+`), remove is red (`-`), context grey (` `). */
export const DEFAULT_PREFIX: Readonly<Record<DiffLineType, string>> = {
  add: '+',
  remove: '-',
  context: ' ',
}

export interface DiffRenderOptions {
  /** Per-type prefix; defaults to {@link DEFAULT_PREFIX}. */
  readonly prefix?: Readonly<Record<DiffLineType, string>>
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
  const prefix = options.prefix ?? DEFAULT_PREFIX
  const maxLines = options.maxLines ?? 500
  const lineNumbers = options.lineNumbers ?? false
  const total = diff.length
  const shown = maxLines > 0 ? Math.min(total, maxLines) : total
  const lines: string[] = []
  for (let k = 0; k < shown; k += 1) {
    const line = diff[k]!
    let head = prefix[line.type]
    if (lineNumbers) {
      if (line.type === 'add') {
        head += `+${String(line.newLine ?? '')} `
      } else if (line.type === 'remove') {
        head += `-${String(line.oldLine ?? '')} `
      } else {
        head += `${String(line.oldLine ?? '')}:${String(line.newLine ?? '')} `
      }
    }
    lines.push(head + line.text)
  }
  if (total > shown) {
    lines.push(`… ${total - shown} more line${total - shown === 1 ? '' : 's'} …`)
  }
  return lines.join('\n')
}

/** Number of changed lines (additions + removals); context lines do not count. */
export function countChangedLines(diff: readonly DiffLine[]): number {
  let changed = 0
  for (const line of diff) {
    if (line.type !== 'context') changed += 1
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
