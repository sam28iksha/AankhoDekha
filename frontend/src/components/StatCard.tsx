import { LucideIcon } from 'lucide-react'

export default function StatCard({ label, value, icon: Icon, color, id, sublabel }: {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  id: string
  sublabel?: string
}) {
  return (
    <div className="stat-card" id={id}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
          <Icon size={14} color={color} />
        </div>
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sublabel && (
        <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{sublabel}</div>
      )}
    </div>
  )
}
