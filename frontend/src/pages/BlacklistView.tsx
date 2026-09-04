import { useEffect, useState, useCallback, useRef } from 'react'
import { Ban, Plus, Trash2, UploadCloud, CheckCircle2, AlertTriangle, FileImage, FileVideo } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import { format } from 'date-fns'
import {
  getBlacklist, addToBlacklist, removeFromBlacklist, uploadDetection,
  type BlacklistEntry, type UploadResult,
} from '../lib/api'

export default function BlacklistView() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [plate, setPlate] = useState('')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    setUploadResult(null)
    try {
      const result = await uploadDetection(file)
      setUploadResult(result)
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
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Ban size={18} style={{ color: 'var(--accent-red)' }} />
            Blacklist &amp; Real-Time Detection Test
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Add plates to the watchlist, then upload footage or a photo to see a live alert fire the moment a match is found.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* ── Add plate form ─────────────────────────────── */}
          <div className="glass-card p-5" id="blacklist-add-form">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Add Plate to Blacklist</h2>
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
                <div className="text-xs" style={{ color: '#ff8a94' }}>{error}</div>
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
          </div>

          {/* ── Test upload ─────────────────────────────────── */}
          <div className="glass-card p-5" id="test-upload-panel">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Test Detection Upload</h2>
            <div
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg cursor-pointer transition-colors"
              style={{ border: '1.5px dashed var(--border)', background: 'rgba(20,28,46,0.5)' }}
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
              <div className="text-xs mt-3" style={{ color: '#ff8a94' }}>{uploadError}</div>
            )}

            {uploadResult && (
              <div className="mt-4 flex flex-col gap-2">
                {uploadResult.type === 'video' ? (
                  <div className="text-xs p-3 rounded" style={{ background: 'rgba(0,180,216,0.08)', border: '1px solid rgba(0,180,216,0.2)', color: 'var(--accent-blue-light)' }}>
                    {uploadResult.message || 'Video queued for background processing — alerts will stream in live.'}
                  </div>
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
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(6,9,15,0.6)' }}>
                  {['Plate', 'Reason', 'Added', ''].map(h => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.plate_number} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="px-5 py-3"><span className="plate-badge blacklisted" style={{ fontSize: '0.75rem' }}>{e.plate_number}</span></td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{e.reason || '—'}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{format(new Date(e.added_at), 'dd MMM yyyy HH:mm')}</td>
                    <td className="px-5 py-3">
                      <button
                        id={`blacklist-remove-${e.plate_number}`}
                        className="btn-secondary py-1 px-3 text-xs flex items-center gap-1"
                        onClick={() => handleRemove(e.plate_number)}
                        disabled={removing === e.plate_number}
                      >
                        {removing === e.plate_number ? <RadarLoader size={11} /> : <Trash2 size={11} />}
                        Remove
                      </button>
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
