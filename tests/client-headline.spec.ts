// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderDiffRows } from '../src/client/diff-rows.ts'
import { findHeadline } from '../src/client/headline.ts'

/** A panel root with the harness's stable anchors and the given body content. */
function panel(bodyHtml: string): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute('data-approval-key', 'k')
  root.innerHTML = `<div class="card"><div class="strip"></div>`
    + `<div data-approval-scroll="">${bodyHtml}</div></div>`
  return root
}

const DIFF = 'edit · a.ts (modify): +1 -1\n    1| -old\n    1| +new'

describe('findHeadline', () => {
  it('finds the body\u2019s first child when the headline sits there (through 0.2.1)', () => {
    const root = panel(`<div class="headline">${DIFF}</div>`)
    const headline = findHeadline(root)
    expect(headline?.className).toBe('headline')
    expect(headline?.textContent).toBe(DIFF)
  })

  it('finds the INNER headline when 0.2.2 wraps it in a .heading row', () => {
    // 0.2.2 moved the headline into `div.heading { display: flex; align-items:
    // center; flex-wrap: wrap }`, which can also hold a warning chip. Returning
    // that wrapper is the bug: injected rows would be flex items, not lines.
    const root = panel(`<div class="heading"><div class="headline">${DIFF}</div></div>`)
    const headline = findHeadline(root)
    expect(headline?.className).toBe('headline')
    expect(headline?.parentElement?.className).toBe('heading')
  })

  it('keeps finding the headline after the rebuild', () => {
    const root = panel(`<div class="heading"><div class="headline">${DIFF}</div></div>`)
    const before = findHeadline(root)
    renderDiffRows(before!)
    // The first text node now belongs to a rendered row, so a content walk alone
    // would return that row; the rows' own classes keep the lookup correct.
    expect(findHeadline(root)).toBe(before)
  })

  it('ignores the command row that follows the headline', () => {
    const root = panel(`<div class="heading"><div class="headline">bash · push</div></div>`
      + `<div class="command">git push origin main</div>`)
    expect(findHeadline(root)?.className).toBe('headline')
  })

  it('returns null without the body seat', () => {
    const root = document.createElement('div')
    root.setAttribute('data-approval-key', 'k')
    root.innerHTML = '<div class="headline">x</div>'
    expect(findHeadline(root)).toBeNull()
  })

  it('returns null when the body has no rendered text yet', () => {
    expect(findHeadline(panel(''))).toBeNull()
    expect(findHeadline(panel('<div class="heading"><div class="headline">  </div></div>'))).toBeNull()
  })

  it('never returns the body itself when text sits directly in it', () => {
    // Replacing the body would take the command row with it, so a bare text node
    // is not a headline.
    expect(findHeadline(panel('bare reason text'))).toBeNull()
  })
})
