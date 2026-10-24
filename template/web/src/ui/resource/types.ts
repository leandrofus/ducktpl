import type { MenuEntry } from '../ContextMenu'

// What a generated resource says about itself (web/src/resources/*.ts).
// The pages and dialogs in this folder are built from it.

export type FieldType = 'string' | 'text' | 'int' | 'float' | 'bool' | 'time' | 'date' | 'json' | 'ref'

export interface RefDef {
  table: string
  url: string
  /** the column shown in place of the id */
  show: string
  /** plural, as in "All projects" */
  label: string
}

export interface FieldDef {
  name: string
  /** shown above the control and in the table header */
  label: string
  type: FieldType
  required?: boolean
  nullable?: boolean
  options?: string[]
  /** the initial value of a new row (enums) */
  default?: string
  ref?: RefDef
}

export type Layout = 'table' | 'cards' | 'feed' | 'chat'

export interface ResourceDef {
  url: string
  /** page title, plural */
  label: string
  /** one row, as in "New note" */
  one: string
  layout: Layout
  fields: FieldDef[]
  /** the ref field that scopes the list to a parent (ducktpl addScope) */
  scope?: string
  /** extra row menu entries (ducktpl adds the links of scoped resources here) */
  actions?: (x: any) => MenuEntry[]
}

export type Row = { id: string; created_at?: string; updated_at?: string } & Record<string, any>
