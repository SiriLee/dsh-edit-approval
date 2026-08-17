/**
 * General-settings row for the edit-approval master switch.
 *
 * Registered into the `settings.general.item` slot (Settings → General, same
 * seat as Appearance / permission presets) by `src/client/index.ts`.
 *
 * The row drives the HOST COMMAND path (`/approval-edit status|on|off`), the
 * same route the keyboard user uses — proven reliable, unlike the client
 * settingsScope RPC which could not persist writes for this namespace. The
 * checkbox flips an optimistic local state on click (instant feedback), then
 * re-queries the host status so the row settles on the true value.
 *
 * @module dsh-edit-approval/client/settings-row
 */

import { useEffect, useState } from 'react'

/** Reactive face injected by the registrant (bound to the /approval-edit command). */
export interface EditApprovalRowInjected {
  /** Resolve the current host enabled state via `/approval-edit status`. */
  getStatus(): Promise<boolean | null>
  /** Persist the given enabled state via `/approval-edit on|off`. */
  toggle(next: boolean): void
}

/**
 * The General-settings toggle row.
 * @param props - the injected face; General rows carry no owner share.
 */
export function EditApprovalRow({ getStatus, toggle }: EditApprovalRowInjected) {
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
  const zh = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')
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
      <span>{zh ? '编辑前审批' : 'Edit approval'}</span>
      <span style={{ color: 'var(--dsw-alias-label-tertiary, #868e96)' }}>
        {zh ? '写类工具（write/edit/str_replace_editor）执行前弹出 diff 审批' : 'Ask before write/edit/str_replace_editor with a line diff'}
      </span>
      <input
        type="checkbox"
        checked={shown}
        disabled={enabled === null}
        onChange={() => {
          const next = !shown
          setEnabled(next) // flip the visual right away
          toggle(next) // host command path
          void getStatus().then((value) => {
            if (value !== null) setEnabled(value) // settle on the host truth
          })
        }}
        aria-label={zh ? '编辑前审批' : 'Edit approval'}
      />
    </label>
  )
}
