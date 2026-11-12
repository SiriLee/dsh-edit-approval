// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DIFF_HEADLINE_CLASS, diffRowsStyle } from '../src/client/diff-rows.ts'

/** The stylesheet as the plugin assembles it (panel anchor + kind marker). */
const STYLE = diffRowsStyle('[data-approval-key]', 'dsh-ea-kind-diff')

describe('diff stylesheet', () => {
  it('sets the diff font on the headline element itself', () => {
    // Regression, hit twice. The panel's own `.headline` rule sets
    // `font-size: 15px; line-height: 24px; font-weight: 500`, and a direct rule on
    // an element beats a value inherited from an ancestor — so while these rules
    // sat on the scroll body, the diff rendered at the panel's headline size,
    // visibly larger than the 13px it is meant to be.
    expect(STYLE).toMatch(new RegExp(`\\.${DIFF_HEADLINE_CLASS}\\s*\\{[^}]*font-size:\\s*13px`))
    expect(STYLE).toMatch(new RegExp(`\\.${DIFF_HEADLINE_CLASS}\\s*\\{[^}]*line-height:\\s*20px`))
  })

  it('never styles or selects the scroll body', () => {
    // Nothing in the diff rendering hangs off that seat any more.
    expect(STYLE).not.toContain('data-approval-scroll')
  })

  it('never uses a positional shape', () => {
    // 0.2.2 inserted a `.heading` wrapper, and positional selectors silently
    // started targeting it instead of the headline.
    expect(STYLE).not.toContain('div:first-child')
    expect(STYLE).not.toContain('> div')
  })

  it('keeps the three row roles coloured', () => {
    for (const role of ['dsh-ea-diff-add', 'dsh-ea-diff-remove', 'dsh-ea-diff-context']) {
      expect(STYLE).toContain(`.${role}`)
    }
  })

  it('scopes every rule to the panel and the diff kind marker', () => {
    const rules = STYLE.split('\n').filter((line) => line.includes('{'))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) expect(rule).toContain('[data-approval-key].dsh-ea-kind-diff')
  })
})
