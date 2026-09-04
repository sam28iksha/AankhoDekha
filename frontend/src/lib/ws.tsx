import { createContext, useContext, useEffect, useRef, useCallback, useState, ReactNode } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

export interface WSMessage {
  type: 'alert' | 'alert_resolved' | 'connected' | 'pong' | 'ping'
  alert_id?: number
  plate_number?: string
  camera_id?: string
  camera_name?: string
  alert_type?: string
  source?: string
  timestamp?: string
  details?: string
  message?: string
}

interface WSContextValue {
  connected: boolean
  messages: WSMessage[]
  subscribe: (cb: (msg: WSMessage) => void) => () => void
}

const WSContext = createContext<WSContextValue | null>(null)

/**
 * Owns the ONE persistent, auto-reconnecting WebSocket connection for the
 * whole app. Mounted once at the App root so switching pages (Live Map,
 * Vehicle Search, Analytics, Alerts…) never tears down or reconnects it —
 * that reconnect churn was what made navigation feel slow.
 *
 * Sends a client-side "ping" every 25 s so the server's 30 s wait_for never
 * times out on an idle connection — keeps the TCP session alive.
 */
export function AlertWebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<WSMessage[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const listenersRef = useRef<Set<(msg: WSMessage) => void>>(new Set())

  const stopPing = useCallback(() => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current)
      pingTimer.current = null
    }
  }, [])

  const startPing = useCallback((ws: WebSocket) => {
    stopPing()
    pingTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping')
      }
    }, 25000)
  }, [stopPing])

  const notifyBrowser = useCallback((msg: WSMessage) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    try {
      const title = msg.alert_type === 'anomaly'
        ? `🚧 Route anomaly: ${msg.plate_number}`
        : `🚨 Blacklist hit: ${msg.plate_number}`
      const n = new Notification(title, {
        body: `${msg.camera_name || 'Unknown camera'}${msg.details ? ' · ' + msg.details : ''}`,
        tag: `nagarnetra-alert-${msg.alert_id}`,
      })
      n.onclick = () => window.focus()
    } catch {
      // Some environments (e.g. insecure context) throw on `new Notification`.
    }
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const ws = new WebSocket(`${WS_URL}/alerts`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      startPing(ws)
      console.log('[NAGARNETRA] WebSocket connected')
    }

    ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data)
        if (msg.type === 'ping' || msg.type === 'pong' || msg.type === 'connected') return
        setMessages(prev => [msg, ...prev].slice(0, 100))
        if (msg.type === 'alert') notifyBrowser(msg)
        listenersRef.current.forEach(cb => cb(msg))
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      stopPing()
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [startPing, stopPing, notifyBrowser])

  useEffect(() => {
    mountedRef.current = true
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    connect()
    return () => {
      mountedRef.current = false
      stopPing()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subscribe = useCallback((cb: (msg: WSMessage) => void) => {
    listenersRef.current.add(cb)
    return () => {
      listenersRef.current.delete(cb)
    }
  }, [])

  return (
    <WSContext.Provider value={{ connected, messages, subscribe }}>
      {children}
    </WSContext.Provider>
  )
}

/**
 * Subscribe to the shared alert WebSocket. Usage is unchanged from before:
 *   const { connected, messages } = useAlertWebSocket(onMessage)
 * — the connection itself now lives in AlertWebSocketProvider, not here.
 */
export function useAlertWebSocket(onMessage?: (msg: WSMessage) => void) {
  const ctx = useContext(WSContext)
  if (!ctx) {
    throw new Error('useAlertWebSocket must be used within <AlertWebSocketProvider>')
  }

  useEffect(() => {
    if (!onMessage) return
    return ctx.subscribe(onMessage)
  }, [onMessage, ctx])

  return { connected: ctx.connected, messages: ctx.messages }
}
