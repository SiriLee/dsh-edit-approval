// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderDiffRows } from '../src/client/diff-rows.ts'

/** Rebuild a synthetic headline seat (mirrors the harness `.headline` anchor). */
function render(reason: string): { classes: string[]; texts: string[] } {
  const headline = document.createElement('div')
  headline.textContent = reason
  renderDiffRows(headline)
  return {
    classes: Array.from(headline.children).map(el => el.className),
    texts: Array.from(headline.children).map(el => el.textContent ?? ''),
  }
}

describe('renderDiffRows', () => {
  it('leaves a single-line reason untouched', () => {
    const headline = document.createElement('div')
    headline.textContent = 'edit · a.ts (modify): 1 insertion, 1 deletion'
    renderDiffRows(headline)
    expect(headline.children.length).toBe(0)
    expect(headline.textContent).toBe('edit · a.ts (modify): 1 insertion, 1 deletion')
  })

  it('renders only change rows (NN| gutter), with ellipsis for skipped context', () => {
    const { classes, texts } = render(
      'edit · a.ts (modify): 1 insertion, 1 deletion\n1:1 const a = 1\n2:2 const b = 2\n    3| -old\n    3| +new\n4:4 const c = 4\n5:5 const d = 5',
    )
    expect(classes).toEqual([
      'dsh-ea-diff-context', // header
      'dsh-ea-diff-ellipsis', // skipped context rows 1-2
      'dsh-ea-diff-remove',
      'dsh-ea-diff-add',
      'dsh-ea-diff-ellipsis', // trailing skipped context
    ])
    expect(texts[2]).toBe('    3| -old')
    expect(texts[3]).toBe('    3| +new')
  })

  it('never misreads a context line whose text starts with - as a removal', () => {
    const { classes } = render('edit · a.ts (modify): 1 insertion, 1 deletion\n1:1 -webkit-box\n    2| -x\n    2| +y')
    // The `old:new` colon keeps `1:1 -webkit-box` from matching the change
    // pattern; it is skipped, with the run marked by an ellipsis.
    expect(classes).toEqual(['dsh-ea-diff-context', 'dsh-ea-diff-ellipsis', 'dsh-ea-diff-remove', 'dsh-ea-diff-add'])
  })

  it('marks hunk gaps with an ellipsis via the index jump', () => {
    const { classes } = render(
      'edit · a.ts (modify): 2 insertions, 2 deletions\n    3| -a\n    3| +A\n ⋯\n    9| -b\n    9| +B',
    )
    expect(classes).toEqual([
      'dsh-ea-diff-context',
      'dsh-ea-diff-remove', 'dsh-ea-diff-add',
      'dsh-ea-diff-ellipsis', // the gap row and its context were skipped
      'dsh-ea-diff-remove', 'dsh-ea-diff-add',
    ])
  })
})
