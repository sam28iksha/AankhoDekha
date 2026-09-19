import { useState } from 'react'
import { Eye, LogIn } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="glass-card p-8 w-full" style={{ maxWidth: 380 }}>
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
            style={{ background: 'linear-gradient(135deg, #023047 0%, #00b4d8 55%, #ffaa4c 100%)', boxShadow: '0 0 18px rgba(0,180,216,0.45)' }}
          >
            <Eye size={22} color="white" />
          </div>
          <div className="font-bold text-lg" style={{ color: 'var(--text-primary)', letterSpacing: '0.05em' }}>AANKHODEKHA</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>The Eye of the City</div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            id="login-username"
            className="search-input"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
          />
          <input
            id="login-password"
            type="password"
            className="search-input"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {error && (
            <div className="text-xs" style={{ color: '#ff8a94' }}>{error}</div>
          )}
          <button
            id="login-submit-btn"
            type="submit"
            className="btn-primary flex items-center justify-center gap-2 mt-1"
            disabled={submitting || !username.trim() || !password}
          >
            {submitting ? <RadarLoader size={14} /> : <LogIn size={14} />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
