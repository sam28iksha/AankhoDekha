// Single shared source of truth for where the login token/identity lives,
// so auth.tsx, api.ts's interceptor, and ws.tsx's WebSocket connection can
// never disagree on the storage key or drift out of sync with each other.
const STORAGE_KEY = 'nagarnetra_auth'

export interface StoredAuth {
  token: string
  username: string
  role: 'admin' | 'investigator' | 'viewer'
}

export function getStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredAuth) : null
  } catch {
    return null
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
}

export function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEY)
}
