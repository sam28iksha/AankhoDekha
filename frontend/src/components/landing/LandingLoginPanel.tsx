import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, ArrowRight, User, Lock } from 'lucide-react'
import { useAuth } from '../../lib/auth'

const CORNER_CLASS = 'absolute w-4 h-4 border-[#6b9959]'

/** Thin corner-bracket frame — recolored to the dashboard's own forest-green
 * accent (--accent-blue in index.css) so this panel, the one piece of the
 * landing page a signed-in operator actually uses, visually hands off to
 * the app it leads into rather than carrying its own disconnected scheme. */
function FramedPanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <span className={`${CORNER_CLASS} -top-2 -left-2 border-t-2 border-l-2`} />
      <span className={`${CORNER_CLASS} -top-2 -right-2 border-t-2 border-r-2`} />
      <span className={`${CORNER_CLASS} -bottom-2 -left-2 border-b-2 border-l-2`} />
      <span className={`${CORNER_CLASS} -bottom-2 -right-2 border-b-2 border-r-2`} />
      <div
        className="w-full max-w-[380px] p-8"
        style={{
          background: 'rgba(15, 20, 16, 0.6)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid rgba(107, 153, 89, 0.25)',
          boxShadow: '0 0 50px rgba(107, 153, 89, 0.1), 0 25px 50px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* Thin gradient accent line — a quiet signature touch under the top edge */}
        <div
          className="absolute top-0 left-8 right-8 h-px"
          style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(107,153,89,0.7) 50%, transparent 100%)' }}
        />
        {children}
      </div>
    </div>
  )
}

/**
 * A real, working sign-in form embedded directly in the hero — not a link
 * out to /login (there is no /login anymore; this panel is the only way
 * in). Recolored to match the dashboard's own green/teal palette
 * (index.css --accent-blue / --accent-blue-light), the same gradient used
 * on Layout.tsx's sidebar logo and the dashboard's primary button.
 */
export default function LandingLoginPanel() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setSubmitting(true)
    setError(null)
    try {
      // Deliberately no navigate() here — a successful login just flips
      // `user` truthy, and this component re-renders into the "signed in"
      // branch below (explicit "Go to Dashboard" button), same as a
      // returning already-logged-in visitor. Staying on Landing after
      // login is the point: the dashboard is a deliberate next step
      // (this button, or scroll/swipe past the hero), not an automatic one.
      await login(username.trim(), password)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const buttonStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, #6b9959 0%, #2a4a2e 100%)',
    color: 'white',
    boxShadow: '0 4px 16px rgba(61, 107, 69, 0.35)',
  }

  const fieldStyle: React.CSSProperties = {
    background: 'rgba(107, 153, 89, 0.08)',
    border: '1px solid rgba(107, 153, 89, 0.25)',
  }

  if (user) {
    return (
      <FramedPanel>
        <div className="text-[#9ecf8c] text-[11px] tracking-[0.14em] mb-2">SIGNED IN</div>
        <div className="text-white text-[14px] font-bold mb-6">{user.username}</div>
        <button
          onClick={() => navigate('/dashboard')}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-semibold transition-opacity hover:opacity-90"
          style={buttonStyle}
        >
          Go to Dashboard
          <ArrowRight size={14} />
        </button>
      </FramedPanel>
    )
  }

  return (
    <FramedPanel>
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #17201a 0%, #3d6b45 55%, #6b9959 100%)' }}
        >
          <Eye size={16} color="white" />
        </div>
        <div className="leading-tight">
          <div className="text-white text-[14px] font-bold">Operator Sign In</div>
          <div className="text-[#9ecf8c]/70 text-[11px] tracking-wide">Access the live dashboard</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="relative">
          <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ecf8c]/50 pointer-events-none" />
          <input
            id="landing-login-username"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full pl-10 pr-3.5 py-3 text-[13px] text-white placeholder-white/35 outline-none transition-colors focus:border-[#6b9959]"
            style={fieldStyle}
          />
        </div>
        <div className="relative">
          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ecf8c]/50 pointer-events-none" />
          <input
            id="landing-login-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full pl-10 pr-10 py-3 text-[13px] text-white placeholder-white/35 outline-none transition-colors focus:border-[#6b9959]"
            style={fieldStyle}
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9ecf8c]/50 hover:text-[#9ecf8c] transition-colors"
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {error && <div className="text-xs" style={{ color: '#ffab91' }}>{error}</div>}
        <button
          id="landing-login-submit"
          type="submit"
          disabled={submitting || !username.trim() || !password}
          className="mt-1.5 inline-flex items-center justify-center gap-2 px-4 py-3 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={buttonStyle}
        >
          <LogIn size={14} />
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </FramedPanel>
  )
}
