/**
 * General-settings toggle row shared by the edit- and bash-approval master
 * switches (one component, two registrations — mirror features stay in
 * lockstep by construction).
 *
 * Registered into the `settings.general.item` slot (Settings → General, same
 * seat as Appearance / permission presets) by `src/client/index.ts`.
 *
 * The row mirrors the harness's native settings cell (EnterBehaviorRow /
 * LanguageRow): a 16px vertical rhythm with a hairline separator (the section
 * strips the separator on its last row), a left column of title (14px) and
 * description (12px), and the control right-aligned and vertically centered.
 *
 * The row drives the HOST COMMAND path (`/approval-edit status|on|off`,
 * `/approval-bash status|on|off`), the same route the keyboard user uses —
 * proven reliable, unlike the client settingsScope RPC which could not
 * persist writes for this namespace. The checkbox flips an optimistic local
 * state on click (instant feedback), then settles on the value the toggle
 * command itself committed — deterministic, no polling delay, no snap-back
 * to a previous outcome.
 *
 * @module dsh-edit-approval/client/settings-row
 */

import { useEffect, useState, type CSSProperties } from 'react'

/** Reactive face injected by the registrant (bound to the feature's toggle command). */
export interface ApprovalToggleRowInjected {
  /** Resolve the current host enabled state via the feature's `status` command. */
  getStatus(): Promise<boolean | null>
  /** Persist the given enabled state; resolves with the value the host committed. */
  toggle(next: boolean): Promise<boolean | null>
}

/** The row copy keys every feature dictionary shares (both namespaces carry them). */
type RowKey = 'settings.title' | 'settings.description'

/** Full Settings-row props: the injected face plus the locale `t` seat. */
type ApprovalToggleRowProps = ApprovalToggleRowInjected & { t: (key: RowKey) => string }

/** Native settings-cell metrics (EnterBehaviorRow.module.css). */
const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2, #dee2e6)',
}

/** Left column: title over description, both vertically centered with the control. */
const TEXT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  paddingRight: '48px',
}

/** Row title: 14px label-primary (native cell title). */
const TITLE_STYLE: CSSProperties = {
  fontSize: '14px',
  fontWeight: 400,
  lineHeight: '22px',
  color: 'var(--dsw-alias-label-primary, #212529)',
}

/** Row description: 12px label-tertiary (native cell description). */
const DESC_STYLE: CSSProperties = {
  fontSize: '12px',
  fontWeight: 400,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #868e96)',
}

/** The checkbox control, right-aligned by the row flex and vertically centered. */
const CONTROL_STYLE: CSSProperties = {
  flex: 'none',
  width: '16px',
  height: '16px',
  cursor: 'pointer',
}

/**
 * The General-settings toggle row. Copy is read through the harness locale
 * seat (`t`), so it follows the user's dsh language preference.
 * @param props - the injected face and the locale `t` seat.
 */
export function ApprovalToggleRow({ getStatus, toggle, t }: ApprovalToggleRowProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void getStatus().then((value) => {
      if (alive && value !== null) setEnabled(value)
    })
    return () => { alive = false }
    // Mount-time status fetch only; getStatus is a stable closure over ctx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shown = enabled === true
  return (
    <div style={ROW_STYLE}>
      <div style={TEXT_STYLE}>
        <div style={TITLE_STYLE}>{t('settings.title')}</div>
        <div style={DESC_STYLE}>{t('settings.description')}</div>
      </div>
      <input
        type="checkbox"
        checked={shown}
        disabled={enabled === null}
        onChange={() => {
          const next = !shown
          setEnabled(next) // flip the visual right away
          // Settle on the value the host committed: toggle resolves with the
          // toggle command's own baselined outcome — deterministic, no polling
          // delay, and no snap-back to a previous outcome.
          void toggle(next).then((value) => {
            if (value !== null) setEnabled(value)
          })
        }}
        aria-label={t('settings.title')}
        style={CONTROL_STYLE}
      />
    </div>
  )
}
