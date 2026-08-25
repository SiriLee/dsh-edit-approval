/**
 * General-settings toggle row shared by the edit- and bash-approval master
 * switches (one component, two registrations — mirror features stay in
 * lockstep by construction).
 *
 * Registered into the `settings.general.item` slot (Settings → General, same
 * seat as Appearance / permission presets) by `src/client/index.ts`.
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

import { useEffect, useState } from 'react'

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
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 0',
        fontSize: '14px',
        cursor: 'pointer',
      }}
    >
      <span>{t('settings.title')}</span>
      <span style={{ color: 'var(--dsw-alias-label-tertiary, #868e96)' }}>
        {t('settings.description')}
      </span>
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
      />
    </label>
  )
}
