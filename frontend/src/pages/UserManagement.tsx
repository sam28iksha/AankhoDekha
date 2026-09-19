import { useState, useEffect, useCallback } from 'react'
import { UserCog, Plus, CheckCircle2, XCircle } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import { format } from 'date-fns'
import { getUsers, createUser, updateUser, type AppUser } from '../lib/api'

const ROLES = ['admin', 'investigator', 'viewer'] as const

export default function UserManagement() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<typeof ROLES[number]>('viewer')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await getUsers())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleCreate = async () => {
    if (!username.trim() || password.length < 6) return
    setCreating(true)
    setError(null)
    try {
      await createUser({ username: username.trim(), password, role, full_name: fullName.trim() || undefined })
      setUsername('')
      setPassword('')
      setFullName('')
      setRole('viewer')
      await fetchUsers()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (u: AppUser) => {
    await updateUser(u.id, { is_active: !u.is_active })
    await fetchUsers()
  }

  const changeRole = async (u: AppUser, newRole: string) => {
    await updateUser(u.id, { role: newRole })
    await fetchUsers()
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <div className="page-kicker">ADMIN ONLY</div>
          <h1 className="page-title flex items-center gap-2">
            <UserCog size={18} style={{ color: 'var(--accent-blue-light)' }} />
            User Management
          </h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Accounts are provisioned here — there is no self-registration.
          </p>
        </div>

        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Create User</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="search-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
            <input className="search-input" type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} />
            <input className="search-input" placeholder="Full name (optional)" value={fullName} onChange={e => setFullName(e.target.value)} />
            <select
              className="text-sm rounded px-3 py-2 outline-none"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              value={role}
              onChange={e => setRole(e.target.value as typeof ROLES[number])}
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {error && <div className="text-xs mt-2" style={{ color: 'var(--accent-critical)' }}>{error}</div>}
          <button
            className="btn-primary flex items-center gap-2 mt-3"
            onClick={handleCreate}
            disabled={creating || !username.trim() || password.length < 6}
          >
            {creating ? <RadarLoader size={14} /> : <Plus size={14} />}
            Create User
          </button>
        </div>

        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Users ({users.length})</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-3" style={{ color: 'var(--text-muted)' }}>
              <RadarLoader size={18} /> Loading…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Username', 'Full Name', 'Role', 'Created', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{u.username}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{u.full_name || '—'}</td>
                    <td className="px-5 py-3">
                      <select
                        className="text-xs rounded px-2 py-1 outline-none"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                        value={u.role}
                        onChange={e => changeRole(u, e.target.value)}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{format(new Date(u.created_at), 'dd MMM yyyy')}</td>
                    <td className="px-5 py-3">
                      {u.is_active
                        ? <span className="tag tag-green flex items-center gap-1 w-fit"><CheckCircle2 size={10} />Active</span>
                        : <span className="tag tag-red flex items-center gap-1 w-fit"><XCircle size={10} />Disabled</span>
                      }
                    </td>
                    <td className="px-5 py-3">
                      <button className="btn-secondary py-1 px-3 text-xs" onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
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
