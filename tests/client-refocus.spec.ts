// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { canFocus, FocusRestore, isEditable } from '../src/client/refocus.ts'

/** Build an editable fixture of a given kind: 'textarea' | 'input' | 'contenteditable' | 'button'. */
function makeEditable(kind: 'textarea' | 'input' | 'contenteditable' | 'button', attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(
    kind === 'button' ? 'button' : kind === 'contenteditable' ? 'div' : kind,
  )
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  if (kind === 'contenteditable') el.setAttribute('contenteditable', 'true')
  return el
}

describe('isEditable', () => {
  it('accepts the composer textarea', () => {
    expect(isEditable(makeEditable('textarea'))).toBe(true)
  })

  it('accepts inputs', () => {
    expect(isEditable(makeEditable('input'))).toBe(true)
  })

  it('accepts contentEditable seats', () => {
    expect(isEditable(makeEditable('contenteditable'))).toBe(true)
  })

  it('rejects buttons and plain elements (approve/reject never overwrite the editor)', () => {
    expect(isEditable(makeEditable('button'))).toBe(false)
    expect(isEditable(document.createElement('div'))).toBe(false)
    expect(isEditable(null)).toBe(false)
  })
})

describe('canFocus', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('accepts an attached editable element', () => {
    const el = makeEditable('textarea')
    document.body.appendChild(el)
    expect(canFocus(el)).toBe(true)
  })

  it('rejects a detached element (remounted composer)', () => {
    expect(canFocus(makeEditable('textarea'))).toBe(false)
  })

  it('rejects a disabled textarea/input (busy session)', () => {
    const el = makeEditable('textarea', { disabled: 'disabled' })
    document.body.appendChild(el)
    expect(canFocus(el)).toBe(false)
  })
})

describe('FocusRestore', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  /** Simulate a `focusin` event with a given target (jsdom has no real focus yet). */
  function focusIn(restore: FocusRestore, target: EventTarget): void {
    restore.onFocusIn({ target } as unknown as FocusEvent)
  }

  it('refocuses the last editable seat after an approval panel is removed', () => {
    const textarea = makeEditable('textarea')
    document.body.appendChild(textarea)
    const restore = new FocusRestore()
    focusIn(restore, textarea)

    textarea.focus()
    expect(document.activeElement).toBe(textarea)
    // A button click (approve) steals focus; it is not editable, so it must
    // not overwrite the remembered editor.
    const approve = makeEditable('button')
    document.body.appendChild(approve)
    approve.focus()
    focusIn(restore, approve)
    expect(document.activeElement).toBe(approve)

    restore.restore()
    expect(document.activeElement).toBe(textarea)
  })

  it('keeps the most recent editable focus when several were used', () => {
    const first = makeEditable('input')
    const second = makeEditable('contenteditable')
    document.body.append(first, second)
    const restore = new FocusRestore()
    focusIn(restore, first)
    focusIn(restore, second)

    restore.restore()
    expect(document.activeElement).toBe(second)
  })

  it('no-ops when nothing editable was ever focused', () => {
    const restore = new FocusRestore()
    expect(() => restore.restore()).not.toThrow()
  })

  it('no-ops when the remembered element was removed from the DOM', () => {
    const textarea = makeEditable('textarea')
    document.body.appendChild(textarea)
    const restore = new FocusRestore()
    focusIn(restore, textarea)
    textarea.remove()

    restore.restore()
    expect(document.activeElement).not.toBe(textarea)
  })

  it('no-ops when the remembered element is disabled (busy composer)', () => {
    const textarea = makeEditable('textarea')
    document.body.appendChild(textarea)
    const restore = new FocusRestore()
    focusIn(restore, textarea)
    textarea.setAttribute('disabled', 'disabled')

    restore.restore()
    expect(document.activeElement).not.toBe(textarea)
  })
})
