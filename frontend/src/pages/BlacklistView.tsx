import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Plus, Trash2, UploadCloud, CheckCircle2, AlertTriangle, FileImage, FileVideo, Clapperboard, ExternalLink } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import { format } from 'date-fns'
import {
  getBlacklist, addToBlacklist, removeFromBlacklist, uploadDetection, simulateAlert,
  getIngestionStatusFor,
  type BlacklistEntry, type UploadResult,
} from '../lib/api'
import { useAuth, hasRole } from '../lib/auth'

export default function BlacklistView() {
  const { user } = useAuth()
  const canEdit = hasRole(user, 'investigator')
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [plate, setPlate] = useState('')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [simulating, setSimulating] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [videoStatus, setVideoStatus] = useState<{ status: string; events_written?: number; errors?: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopVideoPolling = useCallback(() => {
    if (videoPollRef.current) { clearInterval(videoPollRef.current); videoPollRef.current = null }
  }, [])

  useEffect(() => () => stopVideoPolling(), [stopVideoPolling])

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await getBlacklist())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const handleAdd = async () => {
    if (!plate.trim()) return
    setAdding(true)
    setError(null)
    try {
      await addToBlacklist(plate.trim().toUpperCase(), reason.trim() || undefined)
      setPlate('')
      setReason('')
      await fetchEntries()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to add plate')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (plateNumber: string) => {
    setRemoving(plateNumber)
    try {
      await removeFromBlacklist(plateNumber)
      setEntries(prev => prev.filter(e => e.plate_number !== plateNumber))
    } catch (err) {
      console.error(err)
    } finally {
      setRemoving(null)
    }
  }

  const handleSimulate = async (plateNumber: string) => {
    setSimulating(plateNumber)
    try {
      await simulateAlert(plateNumber, 'blacklist_hit')
    } catch (err) {
      console.error(err)
    } finally {
      setSimulating(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    setUploadResult(null)
    setVideoStatus(null)
    stopVideoPolling()
    try {
      const result = await uploadDetection(file)
      setUploadResult(result)

      // Images resolve synchronously (result already has detections).
      // Videos are queued as a background job — the backend tells us to poll
      // for it, so actually do that instead of leaving the user staring at
      // a static "processing" message forever.
      if (result.type === 'video' && result.camera_id) {
        setVideoStatus({ status: 'running' })
        videoPollRef.current = setInterval(async () => {
          try {
            const s = await getIngestionStatusFor(result.camera_id)
            setVideoStatus(s)
            if (s.status === 'done' || s.status === 'error') {
              stopVideoPolling()
            }
          } catch (err) {
            console.error(err)
            stopVideoPolling()
          }
        }, 1500)
      }
    } catch (err: any) {
      setUploadError(err?.response?.data?.detail || 'Upload failed — check the file is a supported image/video.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="page-kicker">WATCHLIST</div>
          <h1 className="page-title flex items-center gap-2">
            <Ban size={18} style={{ color: 'var(--accent-red)' }} />
            Blacklist &amp; Real-Time Detection Test
          </h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Add plates to the watchlist — this only updates the list, it doesn't fire an alert by itself. Real alerts fire when actual footage is processed and a match is found (upload below, or process a live camera feed).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* ── Add plate form ─────────────────────────────── */}
          <div className="glass-card p-5" id="blacklist-add-form">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Add Plate to Blacklist</h2>
            {!canEdit ? (
              <div className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                Your role ({user?.role}) is read-only here. Adding plates requires the investigator role.
              </div>
            ) : (
            <div className="flex flex-col gap-3">
              <input
                id="blacklist-plate-input"
                className="search-input"
                placeholder="e.g. DL01AB1234"
                value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())}
              />
              <input
                id="blacklist-reason-input"
                className="search-input"
                style={{ fontFamily: 'Inter, sans-serif' }}
                placeholder="Reason (optional) — e.g. stolen vehicle"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              {error && (
                <div className="text-xs" style={{ color: 'var(--accent-critical)' }}>{error}</div>
              )}
              <button
                id="blacklist-add-btn"
                className="btn-primary flex items-center justify-center gap-2"
                onClick={handleAdd}
                disabled={adding || !plate.trim()}
              >
                {adding ? <RadarLoader size={14} /> : <Plus size={14} />}
                Add to Blacklist
              </button>
            </div>
            )}
          </div>

          {/* ── Test upload ─────────────────────────────────── */}
          <div className="glass-card p-5" id="test-upload-panel">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Test Detection Upload</h2>
            {!canEdit ? (
              <div className="text-xs py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                Your role ({user?.role}) is read-only here. Running detection tests requires the investigator role.
              </div>
            ) : (
            <>
            <div
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg cursor-pointer transition-colors"
              style={{ border: '1.5px dashed var(--border)', background: 'var(--bg-input)' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                id="upload-file-input"
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={e => { setFile(e.target.files?.[0] ?? null); setUploadResult(null); setUploadError(null) }}
              />
              {file ? (
                <>
                  {file.type.startsWith('video') ? <FileVideo size={24} style={{ color: 'var(--accent-blue-light)' }} /> : <FileImage size={24} style={{ color: 'var(--accent-blue-light)' }} />}
                  <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{file.name}</div>
                </>
              ) : (
                <>
                  <UploadCloud size={24} style={{ color: 'var(--text-muted)' }} />
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Click to choose a photo or video</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Runs the ANPR pipeline and alerts on any blacklist hit</div>
                </>
              )}
            </div>

            <button
              id="upload-detect-btn"
              className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? <RadarLoader size={14} /> : <UploadCloud size={14} />}
              {uploading ? 'Processing…' : 'Upload & Detect'}
            </button>

            {uploadError && (
              <div className="text-xs mt-3" style={{ color: 'var(--accent-critical)' }}>{uploadError}</div>
            )}

            {uploadResult && (
              <div className="mt-4 flex flex-col gap-2">
                {uploadResult.type === 'video' ? (
                  videoStatus?.status === 'done' ? (
                    <div className="text-xs p-3 rounded flex items-center gap-2" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: 'var(--accent-green)' }}>
                      <CheckCircle2 size={13} />
                      Done — {videoStatus.events_written ?? 0} plate event(s) processed. Any blacklist match already fired as a live alert — check the Alerts page.
                    </div>
                  ) : videoStatus?.status === 'error' ? (
                    <div className="text-xs p-3 rounded flex items-center gap-2" style={{ background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.3)', color: 'var(--accent-critical)' }}>
                      <AlertTriangle size={13} />
                      Processing failed{videoStatus.errors?.length ? `: ${videoStatus.errors[0]}` : '.'}
                    </div>
                  ) : (
                    <div className="text-xs p-3 rounded flex items-center gap-2" style={{ background: 'rgba(0,180,216,0.08)', border: '1px solid rgba(0,180,216,0.2)', color: 'var(--accent-blue-light)' }}>
                      <RadarLoader size={13} />
                      Processing video{videoStatus?.events_written ? ` — ${videoStatus.events_written} event(s) so far…` : '…'}
                    </div>
                  )
                ) : uploadResult.detections && uploadResult.detections.length > 0 ? (
                  uploadResult.detections.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded text-xs"
                      style={{
                        background: d.blacklisted ? 'rgba(230,57,70,0.1)' : 'rgba(34,197,94,0.08)',
                        border: `1px solid ${d.blacklisted ? 'rgba(230,57,70,0.3)' : 'rgba(34,197,94,0.2)'}`,
                      }}
                    >
                      <span className={`plate-badge ${d.blacklisted ? 'blacklisted' : ''}`} style={{ fontSize: '0.7rem', padding: '2px 8px' }}>{d.plate_number}</span>
                      {d.blacklisted ? (
                        <span className="tag tag-red flex items-center gap-1"><AlertTriangle size={10} />Blacklist hit</span>
                      ) : (
                        <span className="tag tag-green flex items-center gap-1"><CheckCircle2 size={10} />Clean</span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>No plate detected in this image.</div>
                )}
              </div>
            )}
            </>
            )}
          </div>
        </div>

        {/* ── Current blacklist ───────────────────────────────── */}
        <div className="glass-card overflow-hidden" id="blacklist-table">
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Current Blacklist ({entries.length})
            </h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-3" style={{ color: 'var(--text-muted)' }}>
              <RadarLoader size={18} /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>No plates blacklisted yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Plate', 'Reason', 'Added', 'Alerts', ''].map(h => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.plate_number} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3"><span className="plate-badge blacklisted" style={{ fontSize: '0.75rem' }}>{e.plate_number}</span></td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{e.reason || '—'}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{format(new Date(e.added_at), 'dd MMM yyyy HH:mm')}</td>
                    <td className="px-5 py-3">
                      <Link
                        to={`/alerts?plate=${encodeURIComponent(e.plate_number)}`}
                        className="text-xs flex items-center gap-1 hover:underline"
                        style={{ color: 'var(--accent-blue-light)' }}
                      >
                        View alerts <ExternalLink size={11} />
                      </Link>
                    </td>
                    <td className="px-5 py-3 flex items-center gap-2">
                      {canEdit ? (
                        <>
                          <button
                            id={`blacklist-simulate-${e.plate_number}`}
                            className="btn-secondary py-1 px-3 text-xs flex items-center gap-1"
                            onClick={() => handleSimulate(e.plate_number)}
                            disabled={simulating === e.plate_number}
                            title="Fires a clearly-labeled simulated alert — demo fallback, not a real detection"
                          >
                            {simulating === e.plate_number ? <RadarLoader size={11} /> : <Clapperboard size={11} />}
                            Simulate sighting
                          </button>
                          <button
                            id={`blacklist-remove-${e.plate_number}`}
                            className="btn-secondary py-1 px-3 text-xs flex items-center gap-1"
                            onClick={() => handleRemove(e.plate_number)}
                            disabled={removing === e.plate_number}
                          >
                            {removing === e.plate_number ? <RadarLoader size={11} /> : <Trash2 size={11} />}
                            Remove
                          </button>
                        </>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
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
