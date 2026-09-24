/**
 * This bundle's configuration card on the Plugins page (`plugins.bundle.config`,
 * keyed by the package name).
 *
 * The staging model, the field controls, and the form frame are the harness's
 * own (`SettingsFormModel` + `SettingsForm` + `Switch`); the card only declares
 * WHICH fields it edits and how a switch renders. Two switches, nothing else —
 * the rest of the entry's `Config` is ordinary configuration and deliberately
 * stays in the profile file, exactly as it was before DSH 0.1.7 collapsed this
 * plugin's two settings namespaces into one entry.
 *
 * The switch field spec clears rather than pins when the draft lands back on the
 * schema default, so the page and the `/approval-*` commands leave the document
 * in the same shape (see `booleanSwitchField`).
 *
 * @module dsh-edit-approval/client/settings-card
 */

import { SettingsFormModel, SettingsForm, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SettingsFieldSpec,
  SettingsFieldState,
  SettingsFormActions,
  SettingsFormLabels,
  SettingsFormScope,
  SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: supplies the `plugins.bundle.config` slot declaration this card's
// props are composed from (the same import the official bundle pages use).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SWITCH_DEFAULTS, type ApprovalSwitchField } from './policy.ts'
import { NS, type ApprovalKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The config card and the panel labels read the plugin's own `edit-approval` dictionary. */
    'edit-approval': ApprovalKey
  }
}

/**
 * The profile entry whose form this is: the bundle's package name, which is the
 * profile row id the host addresses the configuration by (the bundle patch
 * declares the row with `id` = `name` = package name).
 */
export const APPROVAL_ENTRY_ID = 'dsh-edit-approval'

/**
 * The two fields the card edits — the entry's volatile set, and nothing else.
 *
 * Derived from {@link ApprovalSwitchField} rather than restated, so the card's
 * field set cannot drift from the contract `tests/config.spec.ts` pins against
 * the real schema.
 */
export type ApprovalPolicy = Readonly<Record<ApprovalSwitchField, boolean>>

/** Card layout: the switch rows and their state hints, on the harness's rhythm. */
export const CARD_STYLE = [
  '.dsh-ea-card-row { display: flex; align-items: center; gap: 8px; }',
  '.dsh-ea-card-label { flex: 1; min-width: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary, #212529); }',
  '.dsh-ea-card-hint { margin: 4px 0 16px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #868e96); }',
].join('\n')

/**
 * A two-state field whose draft, when it lands back on the schema default,
 * stages a CLEAR instead of a copy of that default.
 *
 * The host resolves an `unset` against the composition layer, so the field
 * re-inherits the schema default and the profile patch keeps only what the user
 * actually changed. That is the same rule the `/approval-*` commands apply, so
 * the page and the commands cannot leave the document in two different shapes —
 * pinning today's default would also silently opt the user out of a later
 * default change.
 *
 * @param field - the document field name.
 * @param fallback - the schema default the clear applies at.
 * @returns the field's conversion spec.
 */
function booleanSwitchField(field: keyof ApprovalPolicy, fallback: boolean): SettingsFieldSpec {
  return {
    field,
    format: value => String(value === true),
    parse: (text) => {
      if (text !== 'true' && text !== 'false') return undefined
      const value = text === 'true'
      return value === fallback ? { kind: 'clear' } : { kind: 'set', value }
    },
  }
}

/** One form snapshot as this card reads it: the frame's state plus both switch drafts. */
export interface ApprovalCardSnapshot extends SettingsFormShell {
  readonly editEnabled: SettingsFieldState
  readonly bashEnabled: SettingsFieldState
}

/**
 * The bound snapshot store the slot renderer rebinds as the card's
 * `useApprovalCard` selector hook.
 */
export interface ApprovalCardStore {
  getSnapshot(): ApprovalCardSnapshot
  subscribe(listener: (() => void)): () => void
}

/** The face the slot registration injects into the card. */
export interface SettingsApprovalFace extends SettingsFormActions {
  readonly hooks: { readonly approvalCard: ApprovalCardStore }
}

/**
 * Props the Plugins page binds for this bundle's configuration card: the slot's
 * runtime owner share (`view`), the locale `t` seat, and the injected form face
 * with its `hooks` compartment rebound as the `useApprovalCard` selector hook.
 */
export type SettingsApprovalCardProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<typeof NS>
  & InjectFace<SettingsApprovalFace>

/** The form frame's copy, read from this plugin's dictionary. */
export function formLabels(t: (key: ApprovalKey) => string): SettingsFormLabels {
  return {
    unavailable: t('form.unavailable'),
    readOnly: t('form.readonly'),
    saveFailed: t('form.saveFailed'),
    save: t('form.save'),
    saving: t('form.saving'),
  }
}

/**
 * Build the staged form over this entry's configuration.
 *
 * `ctx.configForms.get(entryId)` is structurally the `SettingsFormScope` the
 * model wants, so it is passed straight in — no cast, exactly as the official
 * settings pages do.
 *
 * @param scope - the shared per-entry configuration form.
 * @returns the model plus the card's bound read hook.
 */
export function approvalForm(scope: SettingsFormScope<ApprovalPolicy>) {
  const form = new SettingsFormModel<ApprovalPolicy>(scope, [
    booleanSwitchField('editEnabled', SWITCH_DEFAULTS.editEnabled),
    booleanSwitchField('bashEnabled', SWITCH_DEFAULTS.bashEnabled),
  ])
  return {
    form,
    store: form.bind((): ApprovalCardSnapshot => ({
      ...form.shell(),
      editEnabled: form.field('editEnabled'),
      bashEnabled: form.field('bashEnabled'),
    })),
  }
}

/** One labelled switch row plus the hint that names the current state. */
function SwitchRow(props: {
  readonly title: string
  readonly hint: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (next: boolean) => void
}) {
  return (
    <div>
      <div className="dsh-ea-card-row">
        <span className="dsh-ea-card-label">{props.title}</span>
        <Switch
          checked={props.checked}
          label={props.title}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      </div>
      <p className="dsh-ea-card-hint">{props.hint}</p>
    </div>
  )
}

/**
 * The bundle's configuration card.
 *
 * @param props - the view, the card's read hook, the locale seat, and the form actions.
 * @returns the form, or null for the summary view.
 */
export function SettingsApprovalCard(props: SettingsApprovalCardProps) {
  const { t, useApprovalCard } = props
  const state = useApprovalCard(snapshot => snapshot)
  // The bundle slot dispatches `page` only; stay inert for anything else so a
  // future shell change cannot render a form with no save control.
  if (props.view === 'summary') return null
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm
      labels={formLabels(t)}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SwitchRow
        title={t('settings.edit.title')}
        hint={t(state.editEnabled.text === 'true' ? 'settings.edit.hint.on' : 'settings.edit.hint.off')}
        checked={state.editEnabled.text === 'true'}
        disabled={disabled}
        onChange={(next) => { props.edit('editEnabled', String(next)) }}
      />
      <SwitchRow
        title={t('settings.bash.title')}
        hint={t(state.bashEnabled.text === 'true' ? 'settings.bash.hint.on' : 'settings.bash.hint.off')}
        checked={state.bashEnabled.text === 'true'}
        disabled={disabled}
        onChange={(next) => { props.edit('bashEnabled', String(next)) }}
      />
    </SettingsForm>
  )
}
