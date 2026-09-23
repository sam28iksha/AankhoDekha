import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import axios from 'axios'
import { getStoredAuth, setStoredAuth, clearStoredAuth, type StoredAuth } from './authToken'

const BASE_URL = '/api'

interface AuthContextValue {
  user: StoredAuth | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  loginError: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredAuth | null>(() => getStoredAuth())
  const [loginError, setLoginError] = useState<string | null>(null)

  const login = useCallback(async (username: string, password: string) => {
    setLoginError(null)
    try {
      // The backend's /auth/login is an OAuth2-password-flow endpoint —
      // form-encoded, not JSON, per FastAPI's OAuth2PasswordRequestForm.
      const form = new URLSearchParams()
      form.append('username', username)
      form.append('password', password)
      const res = await axios.post(`${BASE_URL}/auth/login`, form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      const auth: StoredAuth = {
        token: res.data.access_token,
        username: res.data.username,
        role: res.data.role,
      }
      setStoredAuth(auth)
      setUser(auth)
    } catch (err: any) {
      setLoginError(err?.response?.data?.detail || 'Login failed.')
      throw err
    }
  }, [])

  const logout = useCallback(() => {
    clearStoredAuth()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout, loginError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

// Rank-based helper mirroring the backend's require_role semantics — a
// higher role satisfies a lower floor (admin can do what investigator can).
const ROLE_RANK: Record<string, number> = { viewer: 0, investigator: 1, admin: 2 }
export function hasRole(user: StoredAuth | null, minRole: 'viewer' | 'investigator' | 'admin'): boolean {
  if (!user) return false
  return ROLE_RANK[user.role] >= ROLE_RANK[minRole]
}
