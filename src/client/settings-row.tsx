/**
 * General-settings row for the edit-approval master switch.
 *
 * Registered into the `settings.general.item` slot (Settings → General, same
 * seat as Appearance / permission presets) by `src/client/index.ts`. The
 * reactive face is bound to the `edit-approval` settings namespace, so the
 * toggle reads and writes the same persisted value the host interception and
 * the `/approval-edit` command use.
 *
 * @module dsh-edit-approval/client/settings-row
 */

import { useSyncExternalStore } from 'react'

/** Reactive face injected by the registrant (bound to the edit-approval scope). */
export interface EditApprovalRowInjected {
  /** Current enabled state (schema default true). */
  getSnapshot(): boolean
  /** Subscribe to enabled-state changes (returns the unsubscribe). */
  subscribe(cb: () => void): () => void
  /** Toggle the plugin master switch (persisted via the settings namespace). */
  toggle(): void
}

/**
 * The General-settings toggle row.
 * @param props - the injected face; General rows carry no owner share.
 */
export function EditApprovalRow({ getSnapshot, subscribe, toggle }: EditApprovalRowInjected) {
  const enabled = useSyncExternalStore(subscribe, getSnapshot)
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
        checked={enabled}
        onChange={() => { toggle() }}
        aria-label={zh ? '编辑前审批' : 'Edit approval'}
      />
    </label>
  )
}
