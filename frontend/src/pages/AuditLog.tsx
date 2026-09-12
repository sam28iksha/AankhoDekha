import { useState, useEffect, useCallback } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import { format } from 'date-fns'
import { getAuditLog, type AuditLogEntry } from '../lib/api'

const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  login_failed: 'Login Failed',
  vehicle_search: 'Vehicle Search',
  vehicle_search_fuzzy: 'Fuzzy Search',
  blacklist_add: 'Blacklist Add',
  blacklist_update: 'Blacklist Update',
  blacklist_remove: 'Blacklist Remove',
  alert_resolve: 'Alert Resolved',
  alert_simulate: 'Alert Simulated',
  user_create: 'User Created',
  user_update: 'User Updated',
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState('')

  const fetchLog = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { limit: 200 }
      if (actionFilter) params.action = actionFilter
      setEntries(await getAuditLog(params))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [actionFilter])

  useEffect(() => { fetchLog() }, [fetchLog])

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="page-kicker">ADMIN ONLY</div>
            <h1 className="page-title flex items-center gap-2">
              <ClipboardList size={18} style={{ color: 'var(--accent-blue-light)' }} />
              Audit Log
            </h1>
            <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Every vehicle search, blacklist change, and alert action — who, what, when.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="text-xs rounded px-2 py-1.5 outline-none"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
            >
              <option value="">All Actions</option>
              {Object.entries(ACTION_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <button className="btn-secondary flex items-center gap-2 py-1.5 px-3 text-xs" onClick={fetchLog}>
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-3" style={{ color: 'var(--text-muted)' }}>
              <RadarLoader size={18} /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>No audit entries match this filter.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(6,9,15,0.6)' }}>
                  {['Time', 'User', 'Action', 'Target', 'Details'].map(h => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(e.timestamp), 'dd MMM HH:mm:ss')}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{e.username}</td>
                    <td className="px-5 py-3">
                      <span className="tag tag-blue">{ACTION_LABELS[e.action] || e.action}</span>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{e.target || '—'}</td>
                    <td className="px-5 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--text-muted)' }}>{e.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
