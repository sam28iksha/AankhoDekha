import { useCallback, useState } from 'react'
import { AlertTriangle, TriangleAlert, X } from 'lucide-react'
import { useAlertWebSocket, WSMessage } from '../lib/ws'

interface ToastItem extends WSMessage {
  toastId: number
}

const AUTO_DISMISS_MS = 6000

/**
 * App-wide popup for live blacklist hits and route anomalies — mounted once
 * in Layout so it appears regardless of which page is open. Complements the
 * native browser Notification fired from AlertWebSocketProvider (covers
 * unfocused tabs / blocked notification permission).
 */
export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((toastId: number) => {
    setToasts(prev => prev.filter(t => t.toastId !== toastId))
  }, [])

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type !== 'alert') return
    const toastId = Date.now() + Math.random()
    setToasts(prev => [...prev, { ...msg, toastId }].slice(-4))
    setTimeout(() => dismiss(toastId), AUTO_DISMISS_MS)
  }, [dismiss])

  useAlertWebSocket(handleWS)

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-5 right-5 z-[2000] flex flex-col gap-2"
      style={{ width: 320 }}
      id="toast-stack"
    >
      {toasts.map(t => {
        const isAnomaly = t.alert_type === 'anomaly'
        const color = isAnomaly ? 'var(--accent-amber)' : 'var(--accent-red)'
        const Icon = isAnomaly ? TriangleAlert : AlertTriangle
        return (
          <div
            key={t.toastId}
            className="alert-row alert-pulse"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 8px 24px rgba(7, 19, 15, 0.16)',
              borderColor: isAnomaly ? 'rgba(255, 176, 32, 0.35)' : undefined,
              borderLeft: `3px solid ${color}`,
            }}
          >
            <Icon size={16} style={{ color, flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color }}>{isAnomaly ? 'Route Anomaly' : 'Blacklist Hit'}</div>
              <div className="text-[13px] font-mono font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{t.plate_number}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t.camera_name}</div>
              {isAnomaly && t.details && (
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t.details}</div>
              )}
            </div>
            <button onClick={() => dismiss(t.toastId)} style={{ color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
