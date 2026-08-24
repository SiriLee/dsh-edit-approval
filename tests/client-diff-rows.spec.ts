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

  it('renders the header muted, context grey, removals red, additions green', () => {
    const { classes, texts } = render(
      'edit · a.ts (modify): 1 insertion, 1 deletion\n 1:1 const a = 1\n-2 const b = 2\n+2 const B = 2\n 3:3 const c = 3',
    )
    expect(classes).toEqual([
      'dsh-ea-diff-context', // header
      'dsh-ea-diff-context', // context line (grey)
      'dsh-ea-diff-remove',
      'dsh-ea-diff-add',
      'dsh-ea-diff-context',
    ])
    expect(texts[0]).toBe('edit · a.ts (modify): 1 insertion, 1 deletion')
    expect(texts[1]).toBe(' 1:1 const a = 1')
    expect(texts[2]).toBe('-2 const b = 2')
    expect(texts[3]).toBe('+2 const B = 2')
  })

  it('renders the ⋯ hunk gap dim and keeps every emitted line', () => {
    const { classes, texts } = render(
      'edit · a.ts (modify): 2 insertions, 2 deletions\n-3 const a = 3\n+3 const A = 3\n ⋯\n-9 const b = 9\n+9 const B = 9',
    )
    expect(classes).toEqual([
      'dsh-ea-diff-context',
      'dsh-ea-diff-remove',
      'dsh-ea-diff-add',
      'dsh-ea-diff-ellipsis', // hunk gap
      'dsh-ea-diff-remove',
      'dsh-ea-diff-add',
    ])
    expect(texts[3]).toBe(' ⋯')
  })

  it('treats an unknown non-+/- line as grey context (defensive)', () => {
    const { classes } = render('edit · a.ts (modify): 0 insertions, 0 deletions\n 1:1 a\n… 2 more lines …')
    expect(classes[1]).toBe('dsh-ea-diff-context')
  })
})
