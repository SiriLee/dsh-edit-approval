import { describe, expect, it } from 'vitest'
import {
  computeLineDiff,
  countChangedLines,
  countDeletions,
  countInsertions,
  renderDiff,
} from '../src/diff.ts'

function typesOf(diff: ReturnType<typeof computeLineDiff>): string[] {
  return diff.map(line => line.type)
}

function textsOf(diff: ReturnType<typeof computeLineDiff>): string[] {
  return diff.map(line => line.text)
}

describe('computeLineDiff', () => {
  it('returns an empty diff for identical content', () => {
    expect(computeLineDiff('a\nb\nc', 'a\nb\nc')).toEqual([])
    expect(countChangedLines([])).toBe(0)
  })

  it('marks pure appends as additions', () => {
    const diff = computeLineDiff('a\nb\n', 'a\nb\nc\nd\n')
    expect(typesOf(diff)).toEqual(['context', 'context', 'add', 'add'])
    expect(countChangedLines(diff)).toBe(2)
    expect(countInsertions(diff)).toBe(2)
    expect(countDeletions(diff)).toBe(0)
  })

  it('marks pure removals as deletions', () => {
    const diff = computeLineDiff('a\nb\nc\n', 'a\n')
    expect(typesOf(diff)).toEqual(['context', 'remove', 'remove'])
    expect(countChangedLines(diff)).toBe(2)
  })

  it('renders a mid-file replacement as remove+add', () => {
    const diff = computeLineDiff('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(typesOf(diff)).toEqual(['context', 'remove', 'add', 'context'])
    expect(textsOf(diff)).toEqual(['one', 'two', 'TWO', 'three'])
  })

  it('treats empty inputs correctly', () => {
    expect(computeLineDiff('', '')).toEqual([])
    expect(typesOf(computeLineDiff('', 'x\ny'))).toEqual(['add', 'add'])
    expect(typesOf(computeLineDiff('x\ny', ''))).toEqual(['remove', 'remove'])
  })

  it('normalizes CRLF line endings for alignment', () => {
    // 'a\r\nb' and 'a\nb' are the same text once CRLF is normalized.
    expect(computeLineDiff('a\r\nb', 'a\nb')).toEqual([])
  })

  it('shows a trailing-newline-only change as a real -/+ pair (no phantom line)', () => {
    const diff = computeLineDiff('a\n', 'a')
    expect(typesOf(diff)).toEqual(['remove', 'add'])
    expect(textsOf(diff)).toEqual(['a', 'a'])
  })

  it('treats an unterminated last line as changed when a line is appended after it', () => {
    // jsdiff (like git) distinguishes a terminator: appending to a file whose
    // last line has no trailing newline re-emits that line as -/+. This is
    // the same basis the harness's result cards use, so the preview stays in
    // lockstep with them.
    const diff = computeLineDiff('a\nb\nc', 'a\nb\nc\nappended')
    expect(typesOf(diff)).toEqual(['context', 'context', 'remove', 'add', 'add'])
    expect(textsOf(diff)).toEqual(['a', 'b', 'c', 'c', 'appended'])
  })

  it('attaches 1-based line numbers from the hunk start lines', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nX\nc')
    const remove = diff.find(line => line.type === 'remove')
    const add = diff.find(line => line.type === 'add')
    const context = diff.find(line => line.type === 'context')
    expect(remove?.oldLine).toBe(2)
    expect(add?.newLine).toBe(2)
    expect(context?.oldLine).toBe(1)
    expect(context?.newLine).toBe(1)
  })

  it('keeps a small edit in a large file precise (no whole-file dump)', () => {
    const oldLines = Array.from({ length: 3000 }, (_, i) => `line-${i}`).join('\n')
    const newLines = oldLines.replace('line-100', 'line-100 EDITED')
    const diff = computeLineDiff(oldLines, newLines)
    // The old untrimmed LCS would have reported 6000 changed lines (the
    // whole file); structuredPatch reports exactly the replaced line inside
    // its bounded context window.
    expect(countChangedLines(diff)).toBe(2)
    expect(diff[0]?.type).toBe('context')
    expect(diff[diff.length - 1]?.type).toBe('context')
    const remove = diff.find(line => line.type === 'remove')
    const add = diff.find(line => line.type === 'add')
    expect(remove?.oldLine).toBe(101)
    expect(add?.newLine).toBe(101)
  })

  it('carries a 3-line context window on each side of a change', () => {
    const oldText = 'a\nb\nc\nd\ne\nOLD\nf\ng\nh'
    const newText = 'a\nb\nc\nd\ne\nNEW\nf\ng\nh'
    const diff = computeLineDiff(oldText, newText)
    expect(typesOf(diff)).toEqual([
      'context', 'context', 'context',
      'remove', 'add',
      'context', 'context', 'context',
    ])
    expect(textsOf(diff)).toEqual(['c', 'd', 'e', 'OLD', 'NEW', 'f', 'g', 'h'])
    expect(diff[3]?.oldLine).toBe(6)
    expect(diff[4]?.newLine).toBe(6)
  })

  it('emits one hunk per scattered change with a bounded context window', () => {
    const oldText = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n'
    const newText = '1\n2\nX\n4\n5\n6\n7\n8\n9\n10\n11\nY\n13\n14\n15\n'
    const diff = computeLineDiff(oldText, newText)
    expect(countChangedLines(diff)).toBe(4)
    // Two independent change blocks, separated by a gap row; the lines
    // between the hunks (7-8) are not part of the diff at all.
    expect(typesOf(diff)).toEqual([
      'context', 'context', 'remove', 'add', 'context', 'context', 'context',
      'gap',
      'context', 'context', 'context', 'remove', 'add', 'context', 'context', 'context',
    ])
    expect(textsOf(diff)).toEqual(['1', '2', '3', 'X', '4', '5', '6', '⋯', '9', '10', '11', '12', 'Y', '13', '14', '15'])
    const removes = diff.filter(line => line.type === 'remove')
    expect(removes.map(line => line.text)).toEqual(['3', '12'])
    expect(removes[0]?.oldLine).toBe(3)
    expect(removes[1]?.oldLine).toBe(12)
    // The gap renders as a space-prefixed '⋯' row between the two hunks.
    expect(renderDiff(diff)).toContain(' ⋯')
  })

  it('handles a change in the tail region after a long equal head', () => {
    const diff = computeLineDiff('a\nb\nc\n', 'a\nb\nc\nappended\n')
    expect(typesOf(diff)).toEqual(['context', 'context', 'context', 'add'])
    expect(diff[3]?.newLine).toBe(4)
  })
})

describe('renderDiff', () => {
  it('prefixes add/remove/context with + - space', () => {
    const diff = computeLineDiff('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(renderDiff(diff)).toBe(' one\n-two\n+TWO\n three')
  })

  it('caps long diffs and reports the remainder', () => {
    const oldText = Array.from({ length: 100 }, (_, i) => `old-${i}`).join('\n')
    const newText = Array.from({ length: 100 }, (_, i) => `new-${i}`).join('\n')
    const text = renderDiff(computeLineDiff(oldText, newText), { maxLines: 10 })
    const lines = text.split('\n')
    expect(lines.length).toBe(11) // 10 shown + "more lines" tail
    expect(lines[lines.length - 1]).toMatch(/… \d+ more lines …/)
  })

  it('renders line numbers when requested', () => {
    const text = renderDiff(computeLineDiff('a\nb', 'a\nX'), { lineNumbers: true })
    // The +/- marker is the diff role; the number follows it once.
    expect(text.split('\n')).toEqual([' 1:1 a', '-2 b', '+2 X'])
  })

  it('supports custom prefixes', () => {
    const text = renderDiff(computeLineDiff('a', 'b'), { prefix: { add: '+', remove: '-', context: ' ' } })
    expect(text).toBe('-a\n+b')
  })
})
