import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Search, AlertTriangle, Navigation, Gauge, Route, GitCommitHorizontal, Radar,
  Play, Pause, Car, ArrowRight,
} from 'lucide-react'
import MapView, { type LegStatus, LEG_STATUS_COLOR } from '../components/MapView'
import RadarLoader from '../components/RadarLoader'
import {
  getVehicleHistory, searchPlates, getTopPlates, getAlerts, type VehicleHistory, type PlateEvent,
  type TrajectoryLeg, type PlateSearchResult, type AlertEntry,
} from '../lib/api'
import { format } from 'date-fns'

// A real alert is matched to the sighting at the same camera within this
// window — alerts fire at (or a few seconds after) the detection event, not
// necessarily the exact same millisecond.
const ALERT_MATCH_WINDOW_MS = 5 * 60 * 1000

// Compact secondary line between two timeline dots — distance/speed/direction
// for the leg leaving this stop. No divider of its own; it sits in the same
// indented column as the dots above/below so the connecting line (drawn by
// TimelineRow) reads as continuous through it.
function LegConnector({ leg }: { leg: TrajectoryLeg }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 10 }}>
        <div className="timeline-dot-line" />
      </div>
      <div className="flex items-center gap-2 flex-wrap pb-2.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {leg.direction && (
          <>
            <Navigation
              size={11}
              style={{ color: 'var(--accent-blue-light)', transform: `rotate(${leg.bearing_deg}deg)`, flexShrink: 0 }}
            />
            <span className="font-semibold" style={{ color: 'var(--accent-blue-light)' }}>{leg.direction}</span>
            <span>·</span>
          </>
        )}
        <span>{leg.distance_km} km in {leg.duration_label}</span>
        {leg.avg_speed_kmh != null && (
          <span className="flex items-center gap-1">
            <Gauge size={10} /> {leg.avg_speed_kmh} km/h
          </span>
        )}
      </div>
    </div>
  )
}

// One row of the Route Timeline — a colored dot (real alert status) plus
// time/camera, connected to the next row by a vertical line. The first and
// last rows get no connector line from TimelineRow itself; the first stop
// still draws its "downward" line here (unless it's also the last), and the
// last stop is tagged "Current Location".
function TimelineRow({
  sighting, status, isLast,
}: {
  sighting: PlateEvent
  status: LegStatus
  isLast: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 10 }}>
        <span
          className={`timeline-dot${isLast ? ' timeline-dot-current' : ''}`}
          style={{ background: LEG_STATUS_COLOR[status] }}
        />
        {!isLast && <div className="timeline-dot-line" />}
      </div>
      <div className="flex-1 min-w-0 pb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent-blue-light)' }}>
            {format(new Date(sighting.timestamp), 'HH:mm')}
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{sighting.camera_name}</span>
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Camera {sighting.camera_id}</div>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {status === 'blacklisted' && (
            <span className="tag tag-red">
              <AlertTriangle size={10} /> BLACKLIST ALERT
            </span>
          )}
          {isLast && <span className="tag tag-gray">Current Location</span>}
        </div>
      </div>
    </div>
  )
}

export default function VehicleSearch() {
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<VehicleHistory | null>(null)
  // Real alerts for this specific plate — used to color trajectory segments
  // by what actually happened (anomaly / blacklist_hit), not a guess.
  const [plateAlerts, setPlateAlerts] = useState<AlertEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrubberIndex, setScrubberIndex] = useState(0)
  const [showRoutes, setShowRoutes] = useState(false)

  // ── Live suggestions dropdown ────────────────────────────────────────
  // Backed by real endpoints (/vehicles/search, /vehicles/top) that were
  // already built and wired into lib/api.ts but never actually used by
  // any page — this is the first thing to consume them.
  const [suggestions, setSuggestions] = useState<PlateSearchResult[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [topPlatesCache, setTopPlatesCache] = useState<PlateSearchResult[] | null>(null)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (plateOverride?: string) => {
    const plate = (plateOverride ?? query).trim()
    if (!plate) return
    setSuggestOpen(false)
    setLoading(true)
    setError(null)
    setHistory(null)
    setPlateAlerts([])
    setScrubberIndex(0)
    try {
      const upper = plate.toUpperCase()
      const [data] = await Promise.all([
        getVehicleHistory(upper),
        getAlerts({ plate_number: upper }).then(setPlateAlerts).catch(() => {}),
      ])
      setHistory(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query])

  // Debounced live search-as-you-type; falls back to "frequently seen"
  // plates (cached after first fetch) when the field is empty, so opening
  // the dropdown is never a dead end even before you've typed anything.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()

    if (trimmed.length < 2) {
      setSuggestions([])
      if (topPlatesCache) {
        setSuggestions(topPlatesCache)
      } else {
        getTopPlates(8).then(top => {
          setTopPlatesCache(top)
          setSuggestions(top)
        }).catch(() => {})
      }
      return
    }

    setSuggestLoading(true)
    debounceRef.current = setTimeout(() => {
      searchPlates(trimmed)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestLoading(false))
    }, 250)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSuggestOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const selectSuggestion = (plate: string) => {
    setQuery(plate)
    setSuggestOpen(false)
    search(plate)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setSuggestOpen(false); return }
    if (!suggestOpen || suggestions.length === 0) {
      if (e.key === 'Enter') search()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestion(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestion(i => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeSuggestion >= 0 && activeSuggestion < suggestions.length) {
        selectSuggestion(suggestions[activeSuggestion].plate_number)
      } else {
        search()
      }
    }
  }

  useEffect(() => { setActiveSuggestion(-1) }, [suggestions])

  // ── Playback — auto-advances the scrubber, replacing the old plain
  // slider-only control with a real play/pause + speed transport. ────────
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  useEffect(() => {
    if (!playing || !history || history.sightings.length < 2) return
    const id = setInterval(() => {
      setScrubberIndex(i => {
        if (i >= history.sightings.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 1100 / playbackSpeed)
    return () => clearInterval(id)
  }, [playing, playbackSpeed, history])

  useEffect(() => { setPlaying(false) }, [history?.plate_number])

  // For trajectory scrubber: only show points up to scrubberIndex
  const trajectorySlice = history?.trajectory?.slice(0, scrubberIndex + 1) ?? []
  const currentSighting = history?.sightings?.[scrubberIndex]

  // ── Real per-stop/per-leg status, derived from actual alerts fired for
  // this plate (matched by camera + time window) — never fabricated. ─────
  const fullStopStatuses: LegStatus[] = (history?.sightings ?? []).map(s => {
    const match = plateAlerts.find(a =>
      a.camera_id === s.camera_id &&
      Math.abs(new Date(a.timestamp).getTime() - new Date(s.timestamp).getTime()) < ALERT_MATCH_WINDOW_MS
    )
    if (match?.alert_type === 'blacklist_hit') return 'blacklisted'
    if (match?.alert_type === 'anomaly') return 'suspicious'
    return 'normal'
  })
  const fullStopLabels = (history?.sightings ?? []).map(s => ({
    name: s.camera_name,
    time: format(new Date(s.timestamp), 'HH:mm'),
    cameraId: s.camera_id,
  }))
  // A leg's color follows the status of the stop it arrives at.
  const fullLegStatuses: LegStatus[] = fullStopStatuses.slice(1)

  const isScrubbing = trajectorySlice.length >= 2 && scrubberIndex < (history?.sightings.length ?? 0) - 1
  const stopStatuses = isScrubbing ? fullStopStatuses.slice(0, scrubberIndex + 1) : fullStopStatuses
  const stopLabels = isScrubbing ? fullStopLabels.slice(0, scrubberIndex + 1) : fullStopLabels
  const legStatuses = isScrubbing ? fullLegStatuses.slice(0, scrubberIndex) : fullLegStatuses

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: search + results ──────────────────────── */}
      <div
        className="w-96 flex flex-col flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}
      >
        {/* Search box */}
        <div className="p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="page-kicker">PLATE LOOKUP</div>
          <div className="page-title-sm mb-3">
            Vehicle Search &amp; Trajectory
          </div>
          <div className="flex gap-2" ref={searchBoxRef} style={{ position: 'relative' }}>
            <div className="search-field">
              <Search size={15} className="search-field-icon" />
              <input
                id="plate-search-input"
                className="search-input"
                placeholder="e.g. DL01AB1234"
                value={query}
                onChange={e => setQuery(e.target.value.toUpperCase())}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={handleKey}
                autoComplete="off"
              />
              {suggestOpen && (suggestions.length > 0 || suggestLoading) && (
                <div className="suggest-dropdown" id="plate-suggest-dropdown">
                  {query.trim().length < 2 && (
                    <div className="suggest-dropdown-label">
                      <Radar size={11} /> FREQUENTLY SEEN
                    </div>
                  )}
                  {suggestLoading && suggestions.length === 0 ? (
                    <div className="suggest-dropdown-empty"><RadarLoader size={14} /></div>
                  ) : (
                    suggestions.map((s, i) => (
                      <button
                        key={s.plate_number}
                        type="button"
                        className={`suggest-row ${i === activeSuggestion ? 'active' : ''}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => selectSuggestion(s.plate_number)}
                      >
                        <span className="plate-badge text-xs">{s.plate_number}</span>
                        <span className="suggest-row-count">{s.sighting_count} sighting{s.sighting_count === 1 ? '' : 's'}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              id="plate-search-btn"
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              onClick={() => search()}
              disabled={loading}
            >
              {loading ? <RadarLoader size={14} /> : <Search size={14} />}
              Search
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.3)', color: 'var(--accent-critical)' }}>
            {error}
          </div>
        )}

        {/* Result header */}
        {/* Vehicle Details card */}
        {history && (
          <div className="p-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="page-kicker mb-2">VEHICLE DETAILS</div>

            <div className="flex items-center gap-3 mb-3">
              {/* No vehicle photo exists in this system's data model — a
                  generic vehicle glyph stands in rather than a fabricated
                  image. */}
              <div
                className="flex items-center justify-center flex-shrink-0 rounded-lg"
                style={{ width: 44, height: 44, background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                <Car size={22} style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                <span className={`plate-badge ${history.blacklisted ? 'blacklisted' : ''}`}>
                  {history.plate_number}
                </span>
                {history.blacklisted && (
                  <span className="tag tag-red">
                    <AlertTriangle size={10} />
                    BLACKLISTED
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 text-xs mb-3">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span className="font-semibold" style={{ color: history.blacklisted ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                  {history.blacklisted ? 'Blacklisted' : 'Active'}
                </span>
              </div>
              {history.last_seen && (
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Last Seen</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {format(new Date(history.last_seen), 'dd MMM HH:mm')}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Total Detections</span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{history.total_sightings}</span>
              </div>
            </div>

            {history.blacklisted && history.blacklist_info && (
              <div className="p-2 rounded text-xs mb-3" style={{ background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.2)', color: 'var(--accent-critical)' }}>
                ⚠ Reason: {history.blacklist_info.reason}
              </div>
            )}

            {history.total_sightings > 0 && (
              <button
                type="button"
                className="text-xs font-semibold flex items-center gap-1"
                style={{ color: 'var(--accent-blue-light)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                onClick={() => document.getElementById('route-timeline-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                View Full Details <ArrowRight size={12} />
              </button>
            )}
          </div>
        )}

        {/* Route Timeline card */}
        <div id="route-timeline-card" className="flex-1 overflow-y-auto p-4">
          {!history && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center" style={{ color: 'var(--text-muted)' }}>
              <Search size={32} className="mb-3 opacity-20" />
              <div className="text-sm">Enter a license plate number</div>
              <div className="text-xs mt-1">e.g. DL01AB1234</div>
            </div>
          )}
          {history && history.sightings.length > 0 && (
            <div className="page-kicker mb-3">ROUTE TIMELINE</div>
          )}
          {history?.sightings.map((event, i) => (
            <div key={event.event_id}>
              <TimelineRow sighting={event} status={fullStopStatuses[i] ?? 'normal'} isLast={i === history.sightings.length - 1} />
              {history.legs[i] && <LegConnector leg={history.legs[i]} />}
            </div>
          ))}
          {history && history.total_sightings === 0 && (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
              <div className="text-sm">No sightings found for this plate.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Map (trajectory) ───────────────────────────────────── */}
      <div className="flex-1 p-3">
        <div className="map-frame map-frame-amber h-full">
          {(history?.trajectory?.length ?? 0) >= 2 && (
            <div className="map-mode-toggle">
              <button
                className={showRoutes ? '' : 'active'}
                onClick={() => setShowRoutes(false)}
              >
                <GitCommitHorizontal size={13} />
                Trajectory
              </button>
              <button
                className={showRoutes ? 'active' : ''}
                onClick={() => setShowRoutes(true)}
              >
                <Route size={13} />
                Possible Routes
              </button>
            </div>
          )}
          <MapView
            trajectory={trajectorySlice.length >= 2 ? trajectorySlice : history?.trajectory}
            trajectoryLabel={history?.plate_number}
            legs={trajectorySlice.length >= 2 ? history?.legs.slice(0, trajectorySlice.length - 1) : history?.legs}
            legStatuses={legStatuses}
            stopStatuses={stopStatuses}
            stopLabels={stopLabels}
            showTrajectoryLegend={!showRoutes}
            showRoutedPaths={showRoutes}
            basemapStyle="command-center"
          />

          {history && history.sightings.length > 1 && (
            <div className="playback-bar">
              <button
                id="playback-play-btn"
                className="playback-play-btn"
                onClick={() => {
                  if (!playing && scrubberIndex >= history.sightings.length - 1) setScrubberIndex(0)
                  setPlaying(p => !p)
                }}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>

              <input
                id="playback-scrubber"
                type="range"
                min={0}
                max={history.sightings.length - 1}
                value={scrubberIndex}
                onChange={e => { setPlaying(false); setScrubberIndex(Number(e.target.value)) }}
                className="playback-scrubber"
              />

              <span className="playback-time">
                {currentSighting ? format(new Date(currentSighting.timestamp), 'HH:mm:ss') : '--:--:--'}
                {' / '}
                {format(new Date(history.sightings[history.sightings.length - 1].timestamp), 'HH:mm:ss')}
              </span>

              <select
                id="playback-speed"
                className="playback-speed-select"
                value={playbackSpeed}
                onChange={e => setPlaybackSpeed(Number(e.target.value))}
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
