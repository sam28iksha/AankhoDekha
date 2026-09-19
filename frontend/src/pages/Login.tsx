import { useState } from 'react'
import { LogIn } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import Logomark from '../components/Logomark'
import CitySkylinePanel from '../components/CitySkylinePanel'
import { useAuth } from '../lib/auth'

// Fixed (not random-per-render) scatter of "camera" nodes across the login
// background — stable positions so the page doesn't visibly re-shuffle on
// every re-render (e.g. while typing).
const LOGIN_NODES = [
  { x: 12, y: 18, delay: 0 }, { x: 24, y: 62, delay: 0.8 }, { x: 8, y: 78, delay: 1.6 },
  { x: 33, y: 30, delay: 0.4 }, { x: 40, y: 85, delay: 2.2 }, { x: 60, y: 15, delay: 1.2 },
  { x: 70, y: 45, delay: 0.2 }, { x: 88, y: 20, delay: 1.8 }, { x: 92, y: 68, delay: 0.6 },
  { x: 78, y: 82, delay: 2.6 }, { x: 55, y: 60, delay: 1.4 }, { x: 18, y: 45, delay: 2.0 },
]

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
    <div className="min-h-screen w-screen flex items-center justify-center relative overflow-x-hidden overflow-y-auto py-8" style={{ background: 'var(--bg-primary)' }}>
      {/* Signature background — a slow radar sweep behind a faint network of
          camera nodes, standing in for the "eye of the city" idea before a
          single word of copy loads. Pure CSS, no extra weight on the bundle. */}
      <div className="login-radar-bg" aria-hidden="true">
        <div className="login-radar-sweep" />
        <div className="login-radar-rings" />
        {LOGIN_NODES.map((n, i) => (
          <span key={i} className="login-network-node" style={{ left: `${n.x}%`, top: `${n.y}%`, animationDelay: `${n.delay}s` }} />
        ))}
      </div>

      <div className="flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12 px-4" style={{ position: 'relative', zIndex: 1 }}>
        <CitySkylinePanel />

        <div className="glass-card p-8 w-full" style={{ maxWidth: 380 }}>
          <div className="flex flex-col items-center mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
              style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 60%, var(--brand-light) 100%)', boxShadow: '0 0 18px rgba(79, 138, 98, 0.4)' }}
            >
              <Logomark size={22} color="white" />
            </div>
            <div className="font-bold text-lg" style={{ color: 'var(--text-primary)', letterSpacing: '0.05em' }}>NAGARNETRA</div>
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
              <div className="text-xs" style={{ color: 'var(--accent-critical)' }}>{error}</div>
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
    </div>
  )
}
