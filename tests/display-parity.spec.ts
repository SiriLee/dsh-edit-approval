// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { computeLineDiff } from '../src/diff.ts'
import { formatReason } from '../src/guard.ts'
import { renderDiffRows } from '../src/client/diff-rows.ts'

/**
 * End-to-end display-parity: the approval panel must show EXACTLY the change
 * rows the algorithm produced — nothing added, nothing dropped, text and
 * color per row. This pins the full chain computeLineDiff → formatReason
 * (renderDiff lineNumbers) → renderDiffRows (client regex + classes).
 */

function renderedChangeRows(reason: string): Array<{ text: string; kind: 'add' | 'remove' }> {
  const headline = document.createElement('div')
  headline.textContent = reason
  renderDiffRows(headline)
  const rows: Array<{ text: string; kind: 'add' | 'remove' }> = []
  for (const el of headline.children) {
    if (el.className === 'dsh-ea-diff-remove') rows.push({ text: el.textContent ?? '', kind: 'remove' })
    else if (el.className === 'dsh-ea-diff-add') rows.push({ text: el.textContent ?? '', kind: 'add' })
  }
  return rows
}

/** The change rows the algorithm produces, rendered exactly as renderDiff would. */
function expectedChangeRows(diff: ReturnType<typeof computeLineDiff>): Array<{ text: string; kind: 'add' | 'remove' }> {
  let max = 0
  for (const l of diff) {
    if (l.oldLine !== undefined && l.oldLine > max) max = l.oldLine
    if (l.newLine !== undefined && l.newLine > max) max = l.newLine
  }
  const width = Math.max(5, String(max).length)
  return diff.filter(l => l.type === 'add' || l.type === 'remove').map(l => l.type === 'add'
    ? { text: `${String(l.newLine).padStart(width)}| +${l.text}`, kind: 'add' as const }
    : { text: `${String(l.oldLine).padStart(width)}| -${l.text}`, kind: 'remove' as const })
}

describe('approval display faithfully mirrors the algorithm', () => {
  const cases: Array<[string, string, string]> = [
    ['single mid-file edit', 'a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nX\nd\ne\nf\ng\n'],
    ['edit at file start', 'one\ntwo\nthree\nfour\nfive\n', 'ONE\ntwo\nthree\nfour\nfive\n'],
    ['multi-hunk', '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n', '1\n2\nX\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\nY\n15\n16\n17\n18\n'],
    ['create', '', 'hello\nworld\n'],
    ['delete', 'x\ny\nz\n', ''],
  ]

  for (const [name, before, after] of cases) {
    it(`renders exactly the algorithm's change rows (${name})`, () => {
      const diff = computeLineDiff(before, after)
      const rows = renderedChangeRows(formatReason('edit', 'f.ts', 'modify', diff))
      expect(rows).toEqual(expectedChangeRows(diff))
    })
  }

  it('does not double-count or drop rows when hunks merge (close changes)', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\n'
    const after = 'a\nb\nC\nd\ne\nF\ng\nh\ni\nj\nk\nL\nm\n'
    const diff = computeLineDiff(before, after)
    const rows = renderedChangeRows(formatReason('edit', 'f.ts', 'modify', diff))
    expect(rows).toEqual(expectedChangeRows(diff))
    expect(rows).toHaveLength(6) // 3 removals + 3 additions, one merged hunk
  })
})
