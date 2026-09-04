import { useState, useEffect, useCallback, useRef } from 'react'
import { Film, Play, Pause, CheckCircle2, AlertTriangle, ScanLine } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import {
  getCameras, startPreview, getPreviewStatus, getPreviewManifest, previewAssetUrl,
  type Camera, type PreviewStatus, type PreviewManifest,
} from '../lib/api'

export default function OCRPreview() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraId, setCameraId] = useState('')
  const [status, setStatus] = useState<PreviewStatus>({ status: 'idle' })
  const [manifest, setManifest] = useState<PreviewManifest | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    getCameras().then(cams => {
      setCameras(cams)
      if (cams.length) setCameraId(cams[0].camera_id)
    }).catch(console.error)
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const loadManifest = useCallback(async (url: string) => {
    const m = await getPreviewManifest(url)
    setManifest(m)
    setFrameIndex(0)
  }, [])

  const handleGenerate = async () => {
    if (!cameraId) return
    setManifest(null)
    setFrameIndex(0)
    setPlaying(false)
    await startPreview(cameraId)
    setStatus({ status: 'processing', progress: 0 })

    stopPolling()
    pollRef.current = setInterval(async () => {
      const s = await getPreviewStatus(cameraId)
      setStatus(s)
      if (s.status === 'done' && s.manifest_url) {
        stopPolling()
        loadManifest(s.manifest_url)
      } else if (s.status === 'error') {
        stopPolling()
      }
    }, 1200)
  }

  useEffect(() => () => stopPolling(), [stopPolling])

  // Playback loop
  useEffect(() => {
    if (playRef.current) { clearInterval(playRef.current); playRef.current = null }
    if (playing && manifest && manifest.frames.length > 0) {
      const intervalMs = 1000 / (manifest.playback_fps || 8)
      playRef.current = setInterval(() => {
        setFrameIndex(i => {
          if (i >= manifest.frames.length - 1) {
            setPlaying(false)
            return i
          }
          return i + 1
        })
      }, intervalMs)
    }
    return () => { if (playRef.current) clearInterval(playRef.current) }
  }, [playing, manifest])

  const currentFrame = manifest?.frames[frameIndex]
  const jumpToTime = (t: number) => {
    if (!manifest) return
    const idx = manifest.frames.findIndex(f => f.t >= t)
    setFrameIndex(idx >= 0 ? idx : 0)
    setPlaying(false)
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ScanLine size={18} style={{ color: 'var(--accent-blue-light)' }} />
            OCR Preview
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Watch the ANPR pipeline detect and read plates frame-by-frame — the same detector, OCR model,
            and format validation that runs in production, visualized.
          </p>
        </div>

        {/* Controls */}
        <div className="glass-card p-4 flex items-center gap-3">
          <select
            id="preview-camera-select"
            value={cameraId}
            onChange={e => setCameraId(e.target.value)}
            className="text-sm rounded px-3 py-2 outline-none flex-1"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {cameras.map(c => (
              <option key={c.camera_id} value={c.camera_id}>{c.name} ({c.camera_id})</option>
            ))}
          </select>
          <button
            id="generate-preview-btn"
            className="btn-primary flex items-center gap-2"
            onClick={handleGenerate}
            disabled={status.status === 'processing'}
          >
            {status.status === 'processing'
              ? <RadarLoader size={14} />
              : <Film size={14} />
            }
            {status.status === 'processing' ? 'Processing…' : 'Generate Preview'}
          </button>
          {status.status === 'processing' && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {status.progress ?? 0} frames analyzed…
            </span>
          )}
          {status.status === 'error' && (
            <span className="text-xs flex items-center gap-1" style={{ color: '#ff8a94' }}>
              <AlertTriangle size={12} /> {status.error || 'Render failed'}
            </span>
          )}
        </div>

        {!manifest && status.status !== 'processing' && (
          <div className="glass-card p-10 flex flex-col items-center justify-center text-center" style={{ color: 'var(--text-muted)' }}>
            <ScanLine size={32} className="mb-3 opacity-30" />
            <div className="text-sm">Pick a camera and click Generate Preview</div>
            <div className="text-xs mt-1">Renders every sampled frame with detection boxes + live OCR text burned in</div>
          </div>
        )}

        {manifest && (
          <div className="grid grid-cols-3 gap-6">
            {/* Frame player */}
            <div className="col-span-2 glass-card p-4">
              <div className="rounded-lg overflow-hidden" style={{ background: '#000' }}>
                {currentFrame && (
                  <img
                    src={previewAssetUrl(currentFrame.url)}
                    alt={`frame ${currentFrame.index}`}
                    className="w-full"
                    style={{ display: 'block' }}
                  />
                )}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  id="preview-play-btn"
                  onClick={() => setPlaying(p => !p)}
                  className="btn-secondary p-2 flex items-center justify-center"
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <input
                  id="preview-scrubber"
                  type="range"
                  min={0}
                  max={manifest.frames.length - 1}
                  value={frameIndex}
                  onChange={e => { setPlaying(false); setFrameIndex(Number(e.target.value)) }}
                  className="flex-1"
                  style={{ accentColor: 'var(--accent-blue-light)' }}
                />
                <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {currentFrame ? `t=${currentFrame.t.toFixed(1)}s` : ''} · frame {frameIndex + 1}/{manifest.frames.length}
                </span>
              </div>

              {currentFrame && currentFrame.plates.length > 0 && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Read at this frame:</span>
                  {currentFrame.plates.map((p, i) => (
                    <span key={i} className="plate-badge" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>{p}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Recognized plates sidebar */}
            <div className="glass-card p-4 flex flex-col">
              <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Recognized Plates ({manifest.plates.length})
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
                {manifest.plates.length === 0 ? (
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>No plate cleared format validation in this clip.</div>
                ) : (
                  manifest.plates.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => jumpToTime(p.t)}
                      className="flex items-center justify-between p-2 rounded text-left transition-colors hover:bg-white/5"
                      style={{ border: '1px solid var(--border)', background: 'rgba(20,28,46,0.5)' }}
                    >
                      <span className="plate-badge" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>{p.plate}</span>
                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--accent-green)' }}>
                        <CheckCircle2 size={11} /> {(p.confidence * 100).toFixed(0)}%
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
