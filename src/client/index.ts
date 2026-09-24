/**
 * dsh-edit-approval — browser half.
 *
 * Two jobs:
 *
 * 1. **Approval-panel enhancement** — rebuilds the panel's diff headline as
 *    red/green per-line blocks (the reason is plain text, so per-line colouring
 *    is impossible without this), adds a disclosure button for tall diffs, and
 *    restores focus to the composer once the approval resolves.
 * 2. **The bundle's configuration card** on the Plugins page, carrying the two
 *    master switches (see `./settings-card.tsx`).
 *
 * Pure DOM injection: no new page, no new popup — the panel's stable data
 * attribute is the only anchor. All side effects are registered as one
 * `ctx.effect`, so plugin unload / HMR tears them down.
 *
 * The bash feature needs NO panel enhancement: the diff colouring, collapse
 * button, and focus restore are panel-level and apply to every approval —
 * multi-line commands already get `pre-wrap` and long ones the collapse.
 *
 * Context typing: `ctx.locale` and `ctx.configForms` come from their own
 * packages' module augmentation. `ctx.slots` does NOT — the package that used
 * to declare it (`@deepseek-ai/dsh-client-runtime`) is gone in DSH 0.1.7, and
 * the renderer that provides the service ships first-party only. The registry
 * is read through the small structural face below, so this half never depends
 * on a first-party client package's internals.
 *
 * @module dsh-edit-approval/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.configForms` service merge (the per-entry form).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale service merge (`ctx.locale`) and the slot
// declaration; runtime copy comes from the dictionary below.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  APPROVAL_ENTRY_ID,
  CARD_STYLE,
  SettingsApprovalCard,
  approvalForm,
  type ApprovalPolicy,
} from './settings-card.tsx'
import { COLLAPSE_STYLE, installCollapseButton } from './collapse.ts'
import { isDiffReason, renderDiffRows } from './diff-rows.ts'
import { FocusRestore } from './refocus.ts'
import { NS, en, zh, type ApprovalKey } from './locales.ts'

/** Stable plugin name. */
export const name = 'dsh-edit-approval/client'

/**
 * Required services: the slot registry (the config card), the locale service
 * (every string), and the per-entry configuration forms.
 *
 * `configForms` is a module-level inject rather than an optional child: the
 * configuration card is half this plugin's surface, and the web profile always
 * composes `ui-settings`.
 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Structural face of the `slots` registry this half uses, declared locally so
 * the plugin never imports the first-party renderer's types.
 */
interface SlotsLike {
  inject(name: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** The config slot a bundle registers its own form into. */
const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'

/** The approval panel root anchor (set by ui-approval's ApprovalPanel). */
const PANEL_SELECTOR = '[data-approval-key]'

/**
 * Plugin-side compensation for a harness presentation quirk: the approval
 * panel headlines the `reason` text in `.headline`, whose CSS has no
 * `white-space: pre-wrap`, so HTML collapses the `\n` line breaks of our
 * multi-line diff into spaces. This rule targets the headline by stable
 * structural anchors (the panel root and the scrollable body seat, both
 * data attributes) and restores the line structure. Harmless if the harness
 * ever adds `pre-wrap` upstream — the selector simply stops matching nothing
 * extra.
 */
const PREWRAP_STYLE = [
  `[data-approval-key] [data-approval-scroll] > div:first-child { white-space: pre-wrap; }`,
].join('\n')

/**
 * Red/green diff rendering: the panel headlines the reason as plain text
 * (no per-line colouring possible), so this plugin rebuilds the headline as
 * one block per line — `+` lines green, `-` lines red, grey context (the
 * host's 3-line window) and `⋯` hunk gaps muted — plus a monospace font to
 * read like a code diff. Purely additive DOM; the panel is mounted once per
 * approval and never re-renders the reason text, so the replacement cannot
 * be clobbered by React.
 *
 * Every selector is scoped to the `dsh-ea-kind-diff` marker `enhance()` adds
 * to the panel root, so the diff look never leaks onto other approval kinds
 * (bash command approvals keep the panel's native styling).
 */
const DIFF_STYLE = [
  '[data-approval-key].dsh-ea-kind-diff [data-approval-scroll] > div:first-child {',
  '  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);',
  '  font-size: 13px;',
  '  line-height: 20px;',
  '}',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-add { color: var(--dsw-alias-state-success-primary, #2f9e44); }',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-remove { color: var(--dsw-alias-state-error-primary, #e03131); }',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-context { color: var(--dsw-alias-label-tertiary, #868e96); }',
  '[data-approval-key].dsh-ea-kind-diff .dsh-ea-diff-ellipsis { color: var(--dsw-alias-label-tertiary, #868e96); opacity: .6; padding-left: 8px; }',
].join('\n')

/** The panel's headline seat (stable data-attribute anchor, same as PREWRAP). */
const HEADLINE_SELECTOR = '[data-approval-scroll] > div:first-child'

/** Panels already enhanced in this page lifetime. */
const enhanced = new WeakSet<Element>()

/** The panel copy this half renders (the disclosure button's labels). */
type PanelKey = Extract<ApprovalKey, 'approval.collapse' | 'approval.expand'>

/**
 * Rebuild the diff headline of one freshly rendered approval panel.
 *
 * Always reports success: a rendered `[data-approval-key]` panel IS the pending
 * approval presentation (DSH 0.1.7 dropped the session-snapshot `pending` list
 * this used to cross-check against), so the panel needs no second gate.
 *
 * @param panel - the freshly rendered panel root.
 * @param t - the plugin's translate seat.
 * @returns true — the caller marks the panel as enhanced.
 */
function enhance(panel: Element, t: (key: PanelKey) => string): boolean {
  const headline = panel.querySelector<HTMLElement>(HEADLINE_SELECTOR)
  if (headline !== null) {
    const text = headline.textContent ?? ''
    if (isDiffReason(text)) {
      // Diff kind (edit approvals): the red/green rebuild plus the collapse
      // button, and the diff styles scoped to this marker.
      panel.classList.add('dsh-ea-kind-diff')
      renderDiffRows(headline)
      // Collapse button: only for real (multi-line) diffs, at the strip's right end.
      if (text.includes('\n')) {
        installCollapseButton(panel, { collapse: t('approval.collapse'), expand: t('approval.expand') })
      }
    } else {
      // Command kind (bash approvals): keep the panel's native look — the
      // headline shows the short reason and the command row renders natively
      // from the tool call. Only the kind marker is added; diff styles never
      // apply here, so the two approval kinds stay visually distinct.
      panel.classList.add('dsh-ea-kind-command')
    }
  }
  return true
}

/** Scan the document for approval panels that are not yet enhanced. */
function scan(t: (key: PanelKey) => string): void {
  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    if (enhanced.has(panel)) continue
    if (enhance(panel, t)) enhanced.add(panel)
  }
}

/**
 * Mount the browser half: inject the plugin's styles, register the
 * configuration card, and observe approval panels to enhance them. Disposal
 * unwinds everything.
 *
 * @param ctx - client root context carrying `slots`, `locale`, `configForms`.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    yield ctx.locale.register(NS, { zh, en })
    const t = ctx.locale.bind(NS)

    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-edit-approval'
    style.textContent = `${PREWRAP_STYLE}\n${DIFF_STYLE}\n${COLLAPSE_STYLE}\n${CARD_STYLE}`
    document.head.appendChild(style)

    // ---- configuration card (Plugins page) ----
    // The slot key and the form's entry id are the SAME string by construction:
    // the bundle patch declares its row with `id` = `name` = package name, and
    // the page dispatches `entryKey: pkg.name` while the settings service keys
    // entries by the row id.
    const slots = (ctx as unknown as { slots: SlotsLike }).slots
    const { store, form } = approvalForm(ctx.configForms.get<ApprovalPolicy>(APPROVAL_ENTRY_ID))
    // The model subscribes to the entry's form on construction, so the fiber
    // must release it on unload (the official settings pages do the same).
    ctx.effect(() => () => { form.dispose() }, 'dsh-edit-approval config form')
    yield slots.inject(BUNDLE_CONFIG_SLOT, () => slots.register({
      name: BUNDLE_CONFIG_SLOT,
      key: APPROVAL_ENTRY_ID,
      locale: NS,
      inject: () => ({ hooks: { approvalCard: store }, ...form.actions() }),
    }, SettingsApprovalCard))

    // ---- approval-panel enhancement ----
    let observer: MutationObserver | undefined
    let scanFrame: number | undefined
    // Approval resolution focus-restore: while the panel is up, the user's
    // focus is on its approve/reject button, so removing the panel drops the
    // caret to <body>. When a `[data-approval-key]` panel is removed from the
    // DOM (the approval resolved), hand focus back to the last editable seat
    // the user was typing in (the composer). See refocus.ts for the guards.
    const focusRestore = new FocusRestore()
    document.addEventListener('focusin', focusRestore.onFocusIn, true)
    const containsPanel = (root: Element): boolean =>
      root.matches(PANEL_SELECTOR) || root.querySelector(PANEL_SELECTOR) !== null
    const onResolved = (records: MutationRecord[]): void => {
      for (const record of records) {
        if (record.type !== 'childList') continue
        for (const node of record.removedNodes) {
          if (node instanceof Element && containsPanel(node)) {
            focusRestore.restore()
            break
          }
        }
      }
    }
    // Batch mutations into one scan per animation frame: a busy session
    // mutates the chat DOM on every streamed token, and a full
    // `[data-approval-key]` query per mutation is wasted while no panel is
    // open. One frame-level scan covers any burst of changes.
    const scheduleScan = (): void => {
      if (scanFrame !== undefined) return
      scanFrame = requestAnimationFrame(() => {
        scanFrame = undefined
        scan(t)
      })
    }
    const start = (): void => {
      observer = new MutationObserver((records) => {
        onResolved(records)
        scheduleScan()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      scan(t)
    }
    const onReady = (): void => { start() }
    if (document.body !== null) start()
    else document.addEventListener('DOMContentLoaded', onReady, { once: true })

    yield () => {
      observer?.disconnect()
      if (scanFrame !== undefined) cancelAnimationFrame(scanFrame)
      document.removeEventListener('focusin', focusRestore.onFocusIn, true)
      document.removeEventListener('DOMContentLoaded', onReady)
      style.remove()
    }
  }, 'dsh-edit-approval client lifecycle')
}
