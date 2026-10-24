import { useState } from 'react'
import { t } from '../../i18n'
import { api, enc } from '../../lib/api'
import { fromLocalInput, toLocalInput } from '../../lib/format'
import { invalidate } from '../../lib/store'
import { Field } from '../Field'
import { Modal, toast } from '../overlays'
import { RefOptions } from './refs'
import type { FieldDef, ResourceDef, Row } from './types'

const isText = (f: FieldDef) => f.type === 'string' || f.type === 'text'

function initial(f: FieldDef, row: Row | undefined, scope: { field?: string; value?: string }): unknown {
  const have = row?.[f.name]
  if (have !== undefined && have !== null) return have
  if (f.name === scope.field) return scope.value ?? ''
  if (f.options?.length) return f.default || f.options[0]
  if (f.nullable) return null
  switch (f.type) {
    case 'time': return new Date().toISOString()
    case 'int': case 'float': return 0
    case 'bool': return false
    case 'json': return '{}'
    default: return ''
  }
}

function control(f: FieldDef, v: Row, set: (val: unknown) => void) {
  const label = t(f.label)
  if (f.options?.length) {
    return (
      <Field label={label}>
        <select value={v[f.name]} onChange={(e) => set(e.currentTarget.value)}>
          {f.options.map((o) => <option key={o} value={o}>{t(o)}</option>)}
        </select>
      </Field>
    )
  }
  switch (f.type) {
    case 'bool':
      return <label className="check"><input type="checkbox" checked={v[f.name]} onChange={(e) => set(e.currentTarget.checked)} /> {label}</label>
    case 'text':
      return <Field label={label}><textarea rows={4} value={v[f.name]} onChange={(e) => set(e.currentTarget.value)} /></Field>
    case 'int':
      return <Field label={label}><input type="number" step={1} value={v[f.name]} onChange={(e) => set(Math.trunc(Number(e.currentTarget.value)))} /></Field>
    case 'float':
      return <Field label={label}><input type="number" step="any" value={v[f.name]} onChange={(e) => set(Number(e.currentTarget.value))} /></Field>
    case 'time':
      return <Field label={label}><input type="datetime-local" value={toLocalInput(v[f.name])} onChange={(e) => set(fromLocalInput(e.currentTarget.value) ?? (f.required ? '' : null))} /></Field>
    case 'ref':
      return (
        <Field label={label}>
          <select value={v[f.name] ?? ''} onChange={(e) => set(e.currentTarget.value || (f.required ? '' : null))}>
            <option value="" disabled={f.required}>—</option>
            {f.ref && <RefOptions ref={f.ref} />}
          </select>
        </Field>
      )
    default:
      return <Field label={label}><input value={v[f.name]} onChange={(e) => set(e.currentTarget.value)} /></Field>
  }
}

/** Create or edit one row, with a control per field. */
export function ResourceDialog({ def, row, scope, preset, onClose }: { def: ResourceDef; row?: Row; scope?: string; /** values a new row starts with */ preset?: Partial<Row>; onClose: () => void }) {
  const [v, setV] = useState<Row>(() => ({
    ...Object.fromEntries(def.fields.map((f) => [f.name, initial(f, row ?? (preset as Row | undefined), { field: def.scope, value: scope })])),
  } as Row))
  const [busy, setBusy] = useState(false)
  const blocked = def.fields.some((f) => f.required && (f.type === 'string' || f.type === 'text' || f.type === 'ref' || f.type === 'time' || f.type === 'date' || f.type === 'json')
    && (isText(f) ? !String(v[f.name] ?? '').trim() : !v[f.name]))
  const submit = async () => {
    setBusy(true)
    try {
      if (row) await api.patch(`${def.url}/${enc(row.id)}`, v)
      else await api.post(def.url, v)
      invalidate(def.url)
      onClose()
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={row ? t('Edit {0}', def.one) : t('New {0}', def.one)}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" disabled={busy || blocked} onClick={submit}>{row ? t('Save') : t('Create')}</button>
      </>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
        {def.fields.map((f) => <div key={f.name} style={{ display: 'contents' }}>{control(f, v, (val) => setV({ ...v, [f.name]: val }))}</div>)}
      </form>
    </Modal>
  )
}
