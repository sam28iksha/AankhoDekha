import { useEffect, useRef, useState } from 'react'
import { LucideIcon } from 'lucide-react'
import { useCountUp } from '../lib/useCountUp'

export default function StatCard({ label, value, icon: Icon, color, id, sublabel, loading, theme }: {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  id: string
  sublabel?: string
  loading?: boolean
  // Optional per-card color overrides (label/value text, border, shadow tint,
  // top accent line) — left undefined, every caller keeps today's look
  // exactly; only the Dashboard KPI row currently opts in, so Analytics'
  // StatCards are untouched by that restyle.
  theme?: { label?: string; value?: string; border?: string; shadow?: string; accent?: string }
}) {
  const isNumeric = typeof value === 'number'
  // useCountUp must run unconditionally (rules of hooks) — feed it 0 for
  // non-numeric values, its result is simply unused in that branch below.
  const animatedValue = useCountUp(isNumeric ? value : 0)

  // Brief highlight flash whenever the value actually changes (not on the
  // initial mount) — makes a stat tick up feel like a live event landed,
  // not just a re-render nobody noticed.
  const [flash, setFlash] = useState(false)
  const prevValue = useRef(value)
  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 700)
      return () => clearTimeout(t)
    }
  }, [value])

  const displayText = loading ? '…' : isNumeric ? animatedValue.toLocaleString() : value

  const cardStyle: Record<string, string> = { ['--flash-color' as string]: color }
  if (theme?.border) cardStyle.border = `1px solid ${theme.border}`
  if (theme?.shadow) cardStyle.boxShadow = theme.shadow
  if (theme?.accent) cardStyle.borderTop = `3px solid ${theme.accent}`

  return (
    <div className={`stat-card${flash ? ' stat-card-flash' : ''}`} id={id} style={cardStyle}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider" style={{ color: theme?.label ?? 'var(--text-muted)', fontWeight: theme?.label ? 700 : 500 }}>{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
          <Icon size={14} color={color} />
        </div>
      </div>
      <div className="text-2xl font-bold" style={{ color: theme?.value ?? 'var(--text-primary)', fontWeight: theme?.value ? 800 : undefined }}>{displayText}</div>
      {sublabel && (
        <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{sublabel}</div>
      )}
    </div>
  )
}
