import type { ReactNode } from 'react'

/** A labelled form control, with optional help below it. */
export function Field({ label, children, help, span }: { label: ReactNode; children: ReactNode; help?: ReactNode; span?: boolean }) {
  return (
    <label className={`field${span ? ' span-2' : ''}`}>
      <span>{label}</span>
      {children}
      {help && <small className="help">{help}</small>}
    </label>
  )
}
