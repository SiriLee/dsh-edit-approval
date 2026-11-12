// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COLLAPSE_BUTTON_CLASS,
  COLLAPSED_CLASS,
  COLLAPSE_STYLE,
  installCollapseButton,
} from '../src/client/collapse.ts'
import { renderDiffRows } from '../src/client/diff-rows.ts'
import { findHeadline } from '../src/client/headline.ts'

/** Minimal ApprovalPanel-shaped fixture (mirrors the harness DOM anchors). */
function makePanel(reason: string): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-approval-key', 'test-key-1')
  const card = document.createElement('div')
  const strip = document.createElement('div')
  strip.className = 'strip'
  strip.innerHTML = '<span class="dot"></span>Waiting for approval'
  const body = document.createElement('div')
  body.setAttribute('data-approval-scroll', '')
  const headline = document.createElement('div')
  headline.textContent = reason
  body.appendChild(headline)
  card.append(strip, body)
  panel.appendChild(card)
  return panel
}

/** 0.2.2+ shape: the headline sits inside a `.heading` row that also carries a warning chip. */
function makePanelV022(reason: string): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-approval-key', 'test-key-2')
  const card = document.createElement('div')
  const strip = document.createElement('div')
  strip.className = 'strip'
  const body = document.createElement('div')
  body.setAttribute('data-approval-scroll', '')
  const heading = document.createElement('div')
  heading.className = 'heading'
  const headline = document.createElement('div')
  headline.className = 'headline'
  headline.textContent = reason
  heading.appendChild(headline)
  body.appendChild(heading)
  card.append(strip, body)
  panel.appendChild(card)
  return panel
}

/**
 * Run the plugin's real rebuild. Calling `renderDiffRows` (rather than a
 * look-alike) matters: the `dsh-ea-diff-*` classes it sets are how the locator
 * recognises a headline it has already rebuilt.
 */
function rebuildHeadline(panel: HTMLElement): void {
  const headline = panel.querySelector('[data-approval-scroll] > div') as HTMLElement
  renderDiffRows(headline)
}

const labels = { collapse: '折叠审批详情', expand: '展开审批详情' }

describe('installCollapseButton', () => {
  beforeEach(() => {
    document.head.querySelectorAll('style[data-test="ea-collapse"]').forEach(el => el.remove())
  })

  function injectStyle(): void {
    const style = document.createElement('style')
    style.dataset.test = 'ea-collapse'
    style.textContent = COLLAPSE_STYLE
    document.head.appendChild(style)
  }

  it('installs a button at the strip end for a multi-line diff, expanded by default', () => {
    const panel = makePanel('edit · a.ts (modify): +3 -2\n+ old line\n- new line')
    installCollapseButton(panel, labels)

    const button = panel.querySelector<HTMLButtonElement>(`.${COLLAPSE_BUTTON_CLASS}`)
    expect(button).not.toBeNull()
    expect(button!.type).toBe('button')
    expect(button!.getAttribute('aria-expanded')).toBe('true')
    expect(button!.getAttribute('aria-label')).toBe(labels.collapse)
    // Hotkey opt-out: dsh-approval-hotkeys must not pick this utility button
    // as the panel's cancel ("first") or confirm ("last") action.
    expect(button!.getAttribute('data-hotkey')).toBe('none')
    expect(panel.classList.contains(COLLAPSED_CLASS)).toBe(false)
    // Button sits inside the strip (card's first child), i.e. the card's top-right.
    const strip = panel.firstElementChild?.firstElementChild
    expect(strip?.lastElementChild).toBe(button)
  })

  it('installs after the diff rebuild (the real enhance() call order)', () => {
    // Regression: enhance() runs renderDiffRows BEFORE installCollapseButton,
    // and the rebuild splits the headline into row divs, so its textContent
    // no longer contains '\n'. The multi-line verdict must still hold.
    const panel = makePanel('edit · a.ts (modify): +3 -2\n+ old line\n- new line')
    rebuildHeadline(panel)
    expect(panel.querySelector('[data-approval-scroll] > div')!.textContent).not.toContain('\n')

    installCollapseButton(panel, labels)
    expect(panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`)).not.toBeNull()
  })

  it('installs when the headline is wrapped in the 0.2.2 `.heading` row', () => {
    // Regression for DSH 0.2.2: the headline moved from the body's first child
    // into a `.heading` flex row (`align-items: center; flex-wrap: wrap`).
    // Positional selectors then landed on that wrapper, so the injected rows
    // became flex items and the diff wrapped sideways instead of stacking.
    const panel = makePanelV022('edit · a.ts (modify): +1 -1\n    1| -old\n    1| +new')
    const heading = panel.querySelector('.heading') as HTMLElement
    const headline = findHeadline(panel)
    expect(headline).not.toBeNull()
    expect(headline).not.toBe(heading) // must not be the flex wrapper

    renderDiffRows(headline!)
    expect(heading.children.length).toBe(1) // wrapper untouched
    expect(headline!.children.length).toBeGreaterThan(1) // rows stacked in the headline

    installCollapseButton(panel, labels)
    expect(panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`)).not.toBeNull()
  })

  it('is a no-op for a single-line approval (no diff to collapse)', () => {
    const panel = makePanel('tool write requests privileged execution')
    installCollapseButton(panel, labels)
    expect(panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`)).toBeNull()
  })

  it('is a no-op without the scrollable body seat', () => {
    const panel = document.createElement('div')
    panel.setAttribute('data-approval-key', 'x')
    expect(() => installCollapseButton(panel, labels)).not.toThrow()
    expect(panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`)).toBeNull()
  })

  it('is idempotent: a second install adds no second button', () => {
    const panel = makePanel('h\n+a\n-b')
    installCollapseButton(panel, labels)
    installCollapseButton(panel, labels)
    expect(panel.querySelectorAll(`.${COLLAPSE_BUTTON_CLASS}`)).toHaveLength(1)
  })

  it('clicking toggles the card class, aria-expanded, and the action label', () => {
    injectStyle()
    const panel = makePanel('h\n+a\n-b')
    installCollapseButton(panel, labels)
    const button = panel.querySelector<HTMLButtonElement>(`.${COLLAPSE_BUTTON_CLASS}`)!
    const body = panel.querySelector('[data-approval-scroll]') as HTMLElement

    button.click()
    expect(panel.classList.contains(COLLAPSED_CLASS)).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe(labels.expand)
    // Collapsed: the injected rule must actually hide the body (jsdom's
    // getComputedStyle caches per element, so this is asserted only here).
    expect(getComputedStyle(body).display).toBe('none')

    button.click()
    expect(panel.classList.contains(COLLAPSED_CLASS)).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe(labels.collapse)
    // No inline style is ever set — visibility is class-driven, so the body
    // is visible again once the collapsed class is gone.
    expect(body.getAttribute('style')).toBeNull()
  })

  it('wires the hide rule to the collapsed card class', () => {
    injectStyle()
    const style = document.head.querySelector('style[data-test="ea-collapse"]')!
    expect(style.textContent).toContain(`[data-approval-key].${COLLAPSED_CLASS} [data-approval-scroll] { display: none; }`)
  })

  it('points the chevron down when expanded and up when collapsed (harness disclosure convention)', () => {
    // The raw icon is a down chevron; expanded shows it unrotated (▾, like the
    // harness open DisclosureRows), collapsed rotates it 180° (▴).
    expect(COLLAPSE_STYLE).toContain(`transform: rotate(0deg)`)
    expect(COLLAPSE_STYLE).toContain(`[data-approval-key].${COLLAPSED_CLASS} .${COLLAPSE_BUTTON_CLASS} svg { transform: rotate(180deg); }`)
  })

  it('wires aria-controls to a stable id on the body', () => {
    const panel = makePanel('h\n+a\n-b')
    installCollapseButton(panel, labels)
    const button = panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`)!
    const body = panel.querySelector('[data-approval-scroll]')!
    expect(body.id).toBe('dsh-ea-body-test-key-1')
    expect(button.getAttribute('aria-controls')).toBe(body.id)
  })

  it('keeps the diff DOM intact while collapsed (CSS-only hide)', () => {
    injectStyle()
    const panel = makePanel('h\n+ kept line')
    installCollapseButton(panel, labels)
    const headline = panel.querySelector('[data-approval-scroll] > div')!
    panel.querySelector(`.${COLLAPSE_BUTTON_CLASS}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(panel.classList.contains(COLLAPSED_CLASS)).toBe(true)
    // The headline stays in the tree untouched — only visibility changes.
    expect(panel.contains(headline)).toBe(true)
    expect(headline.textContent).toBe('h\n+ kept line')
  })
})
