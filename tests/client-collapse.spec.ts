// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COLLAPSE_BUTTON_CLASS,
  COLLAPSED_CLASS,
  COLLAPSE_STYLE,
  installCollapseButton,
} from '../src/client/collapse.ts'

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

/** Mimic the plugin's `renderDiffRows` rebuild: split the headline text into row divs. */
function rebuildHeadline(panel: HTMLElement): void {
  const headline = panel.querySelector('[data-approval-scroll] > div') as HTMLElement
  const lines = headline.textContent!.split('\n')
  headline.textContent = ''
  for (const line of lines) {
    const row = document.createElement('div')
    row.textContent = line
    headline.appendChild(row)
  }
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
