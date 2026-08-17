import { describe, expect, it } from 'vitest'
import {
  computeLineDiff,
  countChangedLines,
  countDeletions,
  countInsertions,
  diffLineArrays,
  renderDiff,
  splitLines,
  MAX_LCS_CELLS,
} from '../src/diff.ts'

function typesOf(diff: ReturnType<typeof computeLineDiff>): string[] {
  return diff.map(line => line.type)
}

function textsOf(diff: ReturnType<typeof computeLineDiff>): string[] {
  return diff.map(line => line.text)
}

describe('splitLines', () => {
  it('splits on LF and CRLF; a trailing newline yields a final empty line', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b', ''])
    expect(splitLines('a\r\nb')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
    expect(splitLines('solo')).toEqual(['solo'])
  })
})

describe('computeLineDiff', () => {
  it('aligns identical content as context lines', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nb\nc')
    expect(typesOf(diff)).toEqual(['context', 'context', 'context'])
    expect(textsOf(diff)).toEqual(['a', 'b', 'c'])
    expect(countChangedLines(diff)).toBe(0)
  })

  it('marks pure appends as additions', () => {
    const diff = computeLineDiff('a\nb', 'a\nb\nc\nd')
    expect(typesOf(diff)).toEqual(['context', 'context', 'add', 'add'])
    expect(countChangedLines(diff)).toBe(2)
    expect(countInsertions(diff)).toBe(2)
    expect(countDeletions(diff)).toBe(0)
  })

  it('marks pure removals as deletions', () => {
    const diff = computeLineDiff('a\nb\nc', 'a')
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
    const diff = computeLineDiff('a\r\nb', 'a\nb')
    expect(typesOf(diff)).toEqual(['context', 'context'])
  })

  it('falls back to whole-file replacement above the LCS cell cap', () => {
    const size = Math.ceil(Math.sqrt(MAX_LCS_CELLS)) + 10
    const oldLines = Array.from({ length: size }, (_, i) => `old-${String(i).padStart(5, '0')}`)
    const newLines = Array.from({ length: size }, (_, i) => `new-${String(i).padStart(5, '0')}`)
    const diff = diffLineArrays(oldLines, newLines)
    expect(typesOf(diff)).toEqual([...Array(size).fill('remove'), ...Array(size).fill('add')])
    expect(diff[0]?.text).toBe(oldLines[0])
    expect(diff[diff.length - 1]?.text).toBe(newLines[newLines.length - 1])
  })

  it('attaches 1-based line numbers', () => {
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
    // The untrimmed LCS cap would have reported 6000 changed lines (the whole
    // file). The trim reports exactly the one replaced line, with the
    // unchanged head/tail preserved as context.
    expect(countChangedLines(diff)).toBe(2)
    expect(diff[0]?.type).toBe('context')
    expect(diff[diff.length - 1]?.type).toBe('context')
    const remove = diff.find(line => line.type === 'remove')
    const add = diff.find(line => line.type === 'add')
    expect(remove?.oldLine).toBe(101)
    expect(add?.newLine).toBe(101)
  })

  it('preserves 1-based line numbers across a trimmed head and tail', () => {
    const oldText = 'a\nb\nc\nd\ne\nOLD\nf\ng\nh'
    const newText = 'a\nb\nc\nd\ne\nNEW\nf\ng\nh'
    const diff = computeLineDiff(oldText, newText)
    expect(typesOf(diff)).toEqual([
      'context', 'context', 'context', 'context', 'context',
      'remove', 'add',
      'context', 'context', 'context',
    ])
    expect(textsOf(diff)).toEqual(['a', 'b', 'c', 'd', 'e', 'OLD', 'NEW', 'f', 'g', 'h'])
    expect(diff[5]?.oldLine).toBe(6)
    expect(diff[6]?.newLine).toBe(6)
  })

  it('handles a change in the tail region after a long equal head', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nb\nc\nappended')
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
    const oldText = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n')
    const newText = `${oldText}\nappended`
    const text = renderDiff(computeLineDiff(oldText, newText), { maxLines: 10 })
    const lines = text.split('\n')
    expect(lines.length).toBe(11) // 10 shown + "more lines" tail
    expect(lines[lines.length - 1]).toMatch(/… \d+ more lines …/)
  })

  it('renders line numbers when requested', () => {
    const text = renderDiff(computeLineDiff('a\nb', 'a\nX'), { lineNumbers: true })
    expect(text).toContain(' 1:1 a')
    expect(text).toContain('-2 b')
    expect(text).toContain('+2 X')
  })

  it('supports custom prefixes', () => {
    const text = renderDiff(computeLineDiff('a', 'b'), { prefix: { add: '+', remove: '-', context: ' ' } })
    expect(text).toBe('-a\n+b')
  })
})
