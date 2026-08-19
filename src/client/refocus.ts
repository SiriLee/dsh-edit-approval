/**
 * Approval-panel focus restore.
 *
 * The harness resolves an approval by removing the `[data-approval-key]`
 * panel from the conversation stream. Because the user clicked that panel's
 * [Allow once] / [Reject] button to approve, focus is on the button when the
 * panel unmounts — the focused element is removed, so focus drops to
 * `<body>` and the composer loses the caret. The user then has to click back
 * into the editor before continuing to type.
 *
 * This module hands focus back: a document-level `focusin` listener records
 * the last editable seat the user actually typed in (the composer textarea,
 * any input, any contentEditable), and {@link FocusRestore.restore} re-focuses
 * that element once an approval panel has been removed. It never depends on
 * the harness composer's DOM — only on "the user was editing this" — and it
 * no-ops unless a focusable, still-attached element was recorded, so it never
 * steals focus from the wrong place.
 *
 * Pure DOM, no framework imports — unit-testable in jsdom.
 *
 * @module dsh-edit-approval/client/refocus
 */

/**
 * Whether an event target is an editable seat worth restoring focus to
 * (the composer textarea, inputs, or any contentEditable). Buttons and other
 * plain elements are never recorded, so focus moved onto an approve/reject
 * button never overwrites the remembered editor.
 */
export function isEditable(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return true
  if (!(target instanceof HTMLElement)) return false
  // `isContentEditable` reflects inherited editability in real browsers but is
  // unimplemented in jsdom; fall back to the `contenteditable` attribute so
  // the seat is recognized there too. `contenteditable="false"` is explicit
  // non-editable and is excluded.
  if (target.isContentEditable) return true
  const state = target.getAttribute('contenteditable')
  return state !== null && state !== '' && state !== 'false'
}

/**
 * Whether a remembered element can still take focus: it must be attached to
 * the document and (for textarea/input) not disabled. Detached elements come
 * from a remounted composer and are dropped; disabled seats mean the session
 * is busy, so re-focusing would be a no-op and is skipped.
 */
export function canFocus(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return !element.disabled
  return true
}

/**
 * Tracks the last editable element the user focused and hands it back once an
 * approval panel that temporarily took focus has resolved.
 */
export class FocusRestore {
  /** The last editable seat the user focused (null until one is seen). */
  private lastEditable: HTMLElement | null = null

  /**
   * Bound `focusin` handler — stable identity so it can be passed to
   * `addEventListener` / `removeEventListener` as-is.
   */
  readonly onFocusIn: (event: FocusEvent) => void = (event) => {
    const target = event.target
    if (target instanceof HTMLElement && isEditable(target)) this.lastEditable = target
  }

  /**
   * Re-focus the last remembered editable seat, if any is still focusable.
   * No-op otherwise (nothing recorded, element detached, or a busy/disabled
   * seat), so it never steals focus from an unrelated place.
   */
  restore(): void {
    const el = this.lastEditable
    if (el === null || !canFocus(el)) return
    el.focus()
  }
}
