import { useState } from 'react'
import type { ReactNode } from 'react'

export interface KanbanColumn<S extends string = string> {
  id: S
  label: ReactNode
  color?: string
}

export function KanbanBoard<T, S extends string = string>({
  columns,
  items,
  itemKey,
  itemStatus,
  renderCard,
  onMoveItem,
}: {
  columns: KanbanColumn<S>[]
  items: T[]
  itemKey: (item: T) => string
  itemStatus: (item: T) => S
  renderCard: (item: T) => ReactNode
  onMoveItem?: (itemId: string, newStatus: S) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<S | null>(null)

  return (
    <div className="kanban-board">
      {columns.map((col) => {
        const colItems = items.filter((x) => itemStatus(x) === col.id)
        const isOver = dragOverCol === col.id

        return (
          <div
            key={col.id}
            className={`kanban-col ${isOver ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverCol(col.id)
            }}
            onDragLeave={() => {
              if (dragOverCol === col.id) setDragOverCol(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOverCol(null)
              if (draggedId && onMoveItem) {
                onMoveItem(draggedId, col.id)
                setDraggedId(null)
              }
            }}
          >
            <div className="kanban-col-head">
              <span className="kanban-col-dot" style={{ backgroundColor: col.color || 'var(--accent)' }} />
              <span className="kanban-col-title">{col.label}</span>
              <span className="kanban-col-count">{colItems.length}</span>
            </div>

            <div className="kanban-col-body">
              {colItems.map((item) => {
                const k = itemKey(item)
                return (
                  <div
                    key={k}
                    className="kanban-card"
                    draggable={!!onMoveItem}
                    onDragStart={() => setDraggedId(k)}
                    onDragEnd={() => setDraggedId(null)}
                  >
                    {renderCard(item)}
                  </div>
                )
              })}
              {colItems.length === 0 && (
                <div className="kanban-col-empty">Sin elementos</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
