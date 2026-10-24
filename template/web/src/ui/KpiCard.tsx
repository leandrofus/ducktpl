import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface KpiCardProps {
  title: ReactNode
  value: ReactNode
  subtext?: ReactNode
  delta?: string
  deltaType?: 'up' | 'down' | 'neutral'
  icon?: ReactNode
  sparkline?: number[]
}

function calcSparklinePoints(data: number[], width: number, height: number): string {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  return data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((val - min) / range) * (height - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function KpiCard({ title, value, subtext, delta, deltaType = 'neutral', icon, sparkline }: KpiCardProps) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-head">
        <span className="kpi-card-title">{title}</span>
        {icon && <span className="kpi-card-icon">{icon}</span>}
      </div>
      <div className="kpi-card-body">
        <div className="kpi-card-val">{value}</div>
        {delta && (
          <div className={`kpi-card-delta delta-${deltaType}`}>
            {deltaType === 'up' && <TrendingUp size={14} />}
            {deltaType === 'down' && <TrendingDown size={14} />}
            {deltaType === 'neutral' && <Minus size={14} />}
            <span>{delta}</span>
          </div>
        )}
      </div>
      {subtext && <div className="kpi-card-subtext">{subtext}</div>}
      {sparkline && sparkline.length > 1 && (
        <svg className="kpi-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={calcSparklinePoints(sparkline, 100, 24)}
          />
        </svg>
      )}
    </div>
  )
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="kpi-grid">{children}</div>
}
