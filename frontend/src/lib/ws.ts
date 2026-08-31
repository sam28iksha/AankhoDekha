import { useEffect, useRef, useCallback, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

export interface WSMessage {
  type: 'alert' | 'alert_resolved' | 'connected' | 'pong'
  alert_id?: number
  plate_number?: string
  camera_id?: string
  camera_name?: string
  alert_type?: string
  timestamp?: string
  details?: string
  message?: string
}

/**
 * React hook for a persistent, auto-reconnecting WebSocket connection.
 * Usage: const { messages, connected } = useAlertWebSocket()
 */
export function useAlertWebSocket(onMessage?: (msg: WSMessage) => void) {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<WSMessage[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const ws = new WebSocket(`${WS_URL}/alerts`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      console.log('[NAGARNETRA] WebSocket connected')
    }

    ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data)
        setMessages(prev => [msg, ...prev].slice(0, 100)) // keep last 100
        onMessage?.(msg)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      if (mountedRef.current) {
        // Auto-reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [onMessage])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const ping = useCallback(() => {
    wsRef.current?.send('ping')
  }, [])

  return { connected, messages, ping }
}
