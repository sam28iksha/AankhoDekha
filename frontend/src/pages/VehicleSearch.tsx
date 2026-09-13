import { useState, useCallback } from 'react'
import {
  Search,
  AlertTriangle,
  Clock,
  Navigation,
  Gauge,
  Route,
  GitCommitHorizontal,
} from 'lucide-react'
import MapView from '../components/MapView'
import RadarLoader from '../components/RadarLoader'
import {
  getVehicleHistory,
  getVehicleEntityHistory,
  type VehicleHistory,
  type VehicleEntityHistory,
  type PlateEvent,
  type TrajectoryLeg,
} from '../lib/api'
import { formatDistanceToNow, format } from 'date-fns'


// ─────────────────────────────────────────────────────────────
// Both plate searches and physical vehicle searches are shown
// through the same UI after being normalized into this shape.
// ─────────────────────────────────────────────────────────────

type SearchResult = VehicleHistory | VehicleEntityHistory


function isVehicleEntityHistory(
  result: SearchResult
): result is VehicleEntityHistory {
  return 'vehicle_id' in result
}


function getDisplayIdentifier(result: SearchResult): string {
  if (isVehicleEntityHistory(result)) {
    return result.vehicle_id
  }

  return result.plate_number
}


function getDisplayPlate(result: SearchResult): string | null {
  if (isVehicleEntityHistory(result)) {
    return result.plates_observed.length > 0
      ? result.plates_observed[0]
      : null
  }

  return result.plate_number
}


function getVehicleType(result: SearchResult): string | null {
  if (result.sightings.length === 0) {
    return null
  }

  return result.sightings[0].vehicle_type || null
}


function getVehicleColor(result: SearchResult): string | null {
  if (result.sightings.length === 0) {
    return null
  }

  return result.sightings[0].color || null
}


// ─────────────────────────────────────────────────────────────
// Trajectory leg connector
// ─────────────────────────────────────────────────────────────

function LegConnector({ leg }: { leg: TrajectoryLeg }) {
  return (
    <div
      className="flex items-center gap-3 pl-3.5 py-1.5 text-xs"
      style={{ color: 'var(--text-secondary)' }}
    >
      <div
        style={{
          width: 2,
          alignSelf: 'stretch',
          background: 'var(--border)',
        }}
      />

      {leg.direction && (
        <>
          <Navigation
            size={13}
            style={{
              color: 'var(--accent-blue-light)',
              transform: `rotate(${leg.bearing_deg}deg)`,
              flexShrink: 0,
            }}
          />

          <span
            className="font-semibold"
            style={{ color: 'var(--accent-blue-light)' }}
          >
            {leg.direction}
          </span>

          <span>·</span>
        </>
      )}

      <span>
        {leg.distance_km} km in {leg.duration_label}
      </span>

      {leg.avg_speed_kmh != null && (
        <span
          className="flex items-center gap-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <Gauge size={11} />
          {leg.avg_speed_kmh} km/h
        </span>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────
// Individual sighting
// ─────────────────────────────────────────────────────────────

function SightingRow({
  event,
  index,
  onVehicleClick,
}: {
  event: PlateEvent
  index: number
  onVehicleClick?: (vehicleId: string) => void
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg transition-colors hover:bg-white/5"
      style={{
        border: '1px solid var(--border)',
        background: 'rgba(20,28,46,0.5)',
      }}
    >
      {/* Timeline marker */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          style={{
            background: 'var(--accent-blue)',
            color: 'white',
          }}
        >
          {index + 1}
        </div>

        {index < 100 && (
          <div
            style={{
              width: 2,
              flex: 1,
              minHeight: 12,
              background: 'var(--border)',
              marginTop: 4,
            }}
          />
        )}
      </div>


      <div className="flex-1 min-w-0">

        {/* Camera + road */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {event.camera_name}
          </span>

          {event.road_segment && (
            <span className="tag tag-blue">
              {event.road_segment}
            </span>
          )}
        </div>


        {/* Vehicle attributes */}
        {(event.vehicle_type || event.color) && (
          <div className="flex items-center gap-2 mt-1 mb-1">

            {event.vehicle_type && (
              <span
                className="tag"
                style={{
                  color: 'var(--accent-blue-light)',
                  background: 'rgba(56,189,248,0.08)',
                }}
              >
                🚗 {event.vehicle_type}
              </span>
            )}

            {event.color && (
              <span
                className="tag"
                style={{
                  color: 'var(--text-secondary)',
                  background: 'rgba(148,163,184,0.08)',
                }}
              >
                🎨 {event.color}
              </span>
            )}

          </div>
        )}

        {event.vehicle_id && (
  <button
    type="button"
    onClick={() =>
      onVehicleClick?.(event.vehicle_id!)
    }
    className="text-xs mt-1"
    style={{
      color: 'var(--accent-blue-light)',
      cursor: 'pointer',
    }}
  >
    Vehicle: {event.vehicle_id} →
  </button>
)}


        {/* Timestamp */}
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="flex items-center gap-1">
            <Clock size={11} />

            {format(
              new Date(event.timestamp),
              'dd MMM HH:mm:ss'
            )}
          </span>

          <span style={{ color: 'var(--text-muted)' }}>
            {formatDistanceToNow(
              new Date(event.timestamp),
              { addSuffix: true }
            )}
          </span>
        </div>


        {/* Coordinates */}
        <div
          className="flex items-center gap-3 mt-1 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>
            📍 {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
          </span>
        </div>

      </div>
    </div>
  )
}



// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export default function VehicleSearch() {
  const [query, setQuery] = useState('')

  const [history, setHistory] =
    useState<SearchResult | null>(null)

  const [loading, setLoading] = useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [scrubberIndex, setScrubberIndex] =
    useState(0)

  const [showRoutes, setShowRoutes] =
    useState(false)


  // ───────────────────────────────────────────────────────────
  // Search
  // ───────────────────────────────────────────────────────────

  const search = useCallback(async (searchQuery?: string) => {
  const cleanQuery = (
    searchQuery ?? query
  ).trim().toUpperCase()

  if (!cleanQuery) return

  setLoading(true)
  setError(null)
  setHistory(null)
  setScrubberIndex(0)

  try {
    let result: SearchResult

    if (cleanQuery.startsWith('V_')) {
      result = await getVehicleEntityHistory(cleanQuery)
    } else {
      result = await getVehicleHistory(cleanQuery)
    }

    setQuery(cleanQuery)
    setHistory(result)
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'response' in err
    ) {
      const axiosError = err as {
        response?: {
          data?: {
            detail?: string
          }
        }
      }

      setError(
        axiosError.response?.data?.detail ||
        'Search failed'
      )
    } else {
      setError('Search failed')
    }
  } finally {
    setLoading(false)
  }
}, [query])


  const handleKey = (
    e: React.KeyboardEvent
  ) => {
    if (e.key === 'Enter') {
      search()
    }
  }


  // ───────────────────────────────────────────────────────────
  // Derived display information
  // ───────────────────────────────────────────────────────────

  const isEntitySearch =
    history !== null &&
    isVehicleEntityHistory(history)

  const displayIdentifier =
    history
      ? getDisplayIdentifier(history)
      : null

  const displayPlate =
    history
      ? getDisplayPlate(history)
      : null

  const vehicleType =
    history
      ? getVehicleType(history)
      : null

  const vehicleColor =
    history
      ? getVehicleColor(history)
      : null


  // ───────────────────────────────────────────────────────────
  // Trajectory scrubber
  // ───────────────────────────────────────────────────────────

  const trajectorySlice =
    history?.trajectory?.slice(
      0,
      scrubberIndex + 1
    ) ?? []

  const currentSighting =
    history?.sightings?.[scrubberIndex]


  return (
    <div className="flex h-full overflow-hidden">

      {/* ═══════════════════════════════════════════════════════
          LEFT PANEL
      ═══════════════════════════════════════════════════════ */}

      <div
        className="w-96 flex flex-col flex-shrink-0 overflow-hidden"
        style={{
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
        }}
      >

        {/* Search */}
        <div
          className="p-4"
          style={{
            borderBottom: '1px solid var(--border)',
          }}
        >

          <div
            className="text-sm font-semibold mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Vehicle Intelligence & Trajectory
          </div>

          <div className="flex gap-2">

            <input
              id="plate-search-input"
              className="search-input"
              placeholder="e.g. DL01AB1234 or V_1E5F2600"
              value={query}
              onChange={e =>
                setQuery(
                  e.target.value.toUpperCase()
                )
              }
              onKeyDown={handleKey}
            />

            <button
              id="plate-search-btn"
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              onClick={() => {
  void search()
}}
              disabled={loading}
            >
              {loading ? (
                <RadarLoader size={14} />
              ) : (
                <Search size={14} />
              )}

              Search
            </button>

          </div>
        </div>


        {/* Error */}
        {error && (
          <div
            className="mx-4 mt-4 p-3 rounded-lg text-sm"
            style={{
              background: 'rgba(230,57,70,0.1)',
              border:
                '1px solid rgba(230,57,70,0.3)',
              color: '#ff8a94',
            }}
          >
            {error}
          </div>
        )}


        {/* ═══════════════════════════════════════════════════
            RESULT HEADER
        ═══════════════════════════════════════════════════ */}

        {history && (
          <div
            className="p-4"
            style={{
              borderBottom:
                '1px solid var(--border)',
            }}
          >

            {/* Identifier */}
            <div className="flex items-center gap-3 mb-3">

              <span
                className={`plate-badge ${
                  !isEntitySearch &&
                  'blacklisted' in history &&
                  history.blacklisted
                    ? 'blacklisted'
                    : ''
                }`}
              >
                {displayIdentifier}
              </span>

              {isEntitySearch && (
                <span
                  className="tag"
                  style={{
                    color: 'var(--accent-blue-light)',
                    background:
                      'rgba(56,189,248,0.08)',
                  }}
                >
                  VEHICLE
                </span>
              )}

              {!isEntitySearch &&
                'blacklisted' in history &&
                history.blacklisted && (
                  <span className="tag tag-red flex items-center gap-1">
                    <AlertTriangle size={10} />
                    BLACKLISTED
                  </span>
                )}

            </div>


            {/* Physical vehicle information */}
            {isEntitySearch && (
              <div
                className="p-2 rounded text-xs mb-3"
                style={{
                  background: 'var(--bg-card)',
                  border:
                    '1px solid var(--border)',
                }}
              >

                <div
                  style={{
                    color: 'var(--text-muted)',
                  }}
                >
                  Physical Vehicle
                </div>

                <div
                  className="font-semibold mt-1"
                  style={{
                    color: 'var(--text-primary)',
                  }}
                >
                  ID: {history.vehicle_id}
                </div>

                {history.plates_observed.length > 0 && (
                  <div
                    className="mt-1"
                    style={{
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Plates:{' '}
                    {history.plates_observed.join(', ')}
                  </div>
                )}

              </div>
            )}

            {/* Blacklist reason */}
            {!isEntitySearch &&
              'blacklisted' in history &&
              history.blacklisted &&
              history.blacklist_info && (
                <div
                  className="p-2 rounded text-xs mb-3"
                  style={{
                    background:
                      'rgba(230,57,70,0.1)',
                    border:
                      '1px solid rgba(230,57,70,0.2)',
                    color: '#ff8a94',
                  }}
                >
                  ⚠ Reason:{' '}
                  {history.blacklist_info.reason}
                </div>
              )}

              {/* Searching */}

              {!isEntitySearch &&
  history.vehicle_ids.length > 0 && (
    <div
      className="p-2 rounded text-xs mb-3"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        Physical Vehicle
      </div>

      <div className="flex flex-wrap gap-2">
        {history.vehicle_ids.map(vehicleId => (
          <button
            key={vehicleId}
            type="button"
            onClick={() => {
              void search(vehicleId)
            }}
            className="tag"
            style={{
              color: 'var(--accent-blue-light)',
              background:
                'rgba(56,189,248,0.08)',
              cursor: 'pointer',
            }}
          >
            {vehicleId} →
          </button>
        ))}
      </div>
    </div>
  )}


            {/* Vehicle attributes */}
            {(vehicleType || vehicleColor) && (
              <div className="flex items-center gap-2 mb-3">

                {vehicleType && (
                  <span
                    className="tag"
                    style={{
                      color:
                        'var(--accent-blue-light)',
                      background:
                        'rgba(56,189,248,0.08)',
                    }}
                  >
                    🚗 {vehicleType}
                  </span>
                )}

                {vehicleColor && (
                  <span
                    className="tag"
                    style={{
                      color:
                        'var(--text-secondary)',
                      background:
                        'rgba(148,163,184,0.08)',
                    }}
                  >
                    🎨 {vehicleColor}
                  </span>
                )}

              </div>
            )}


            {/* Summary */}
            <div className="grid grid-cols-2 gap-2 text-xs">

              <div
                className="p-2 rounded"
                style={{
                  background:
                    'var(--bg-card)',
                }}
              >
                <div
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  Sightings
                </div>

                <div
                  className="font-bold text-base mt-0.5"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {history.total_sightings}
                </div>
              </div>


              <div
                className="p-2 rounded"
                style={{
                  background:
                    'var(--bg-card)',
                }}
              >
                <div
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  Cameras
                </div>

                <div
                  className="font-bold text-base mt-0.5"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {history.cameras_visited.length}
                </div>
              </div>

            </div>


            {/* Timeline scrubber */}
            {history.sightings.length > 1 && (
              <div className="mt-3">

                <div
                  className="text-xs mb-1 flex justify-between"
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  <span>
                    Timeline Scrubber
                  </span>

                  <span>
                    {scrubberIndex + 1} /{' '}
                    {history.sightings.length}
                  </span>
                </div>


                <input
                  id="trajectory-scrubber"
                  type="range"
                  min={0}
                  max={
                    history.sightings.length - 1
                  }
                  value={scrubberIndex}
                  onChange={e =>
                    setScrubberIndex(
                      Number(e.target.value)
                    )
                  }
                  className="w-full"
                  style={{
                    accentColor:
                      'var(--accent-blue-light)',
                  }}
                />


                {currentSighting && (
                  <div
                    className="text-xs mt-1"
                    style={{
                      color:
                        'var(--text-secondary)',
                    }}
                  >
                    📍{' '}
                    {currentSighting.camera_name}
                    {' — '}
                    {format(
                      new Date(
                        currentSighting.timestamp
                      ),
                      'HH:mm:ss'
                    )}
                  </div>
                )}

              </div>
            )}

          </div>
        )}


        {/* ═══════════════════════════════════════════════════
            SIGHTINGS
        ═══════════════════════════════════════════════════ */}

        <div
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-2"
        >

          {!history && !loading && (
            <div
              className="flex flex-col items-center justify-center h-full text-center"
              style={{
                color:
                  'var(--text-muted)',
              }}
            >
              <Search
                size={32}
                className="mb-3 opacity-20"
              />

              <div className="text-sm">
                Enter a license plate or vehicle ID
              </div>

              <div className="text-xs mt-1">
                e.g. UP14FE8002 or V_1E5F2600
              </div>
            </div>
          )}


          {history?.sightings.map(
            (event, i) => (
              <div key={event.event_id}>

                <SightingRow
        event={event}
        index={i}
        onVehicleClick={(vehicleId) => {
          void search(vehicleId)
        }}
      />

                {history.legs[i] && (
                  <LegConnector
                    leg={history.legs[i]}
                  />
                )}

              </div>
            )
          )}


          {history &&
            history.total_sightings === 0 && (
              <div
                className="text-center py-8"
                style={{
                  color:
                    'var(--text-muted)',
                }}
              >
                <div className="text-sm">
                  No sightings found for this query.
                </div>
              </div>
            )}

        </div>

      </div>


      {/* ═══════════════════════════════════════════════════════
          MAP
      ═══════════════════════════════════════════════════════ */}

      <div className="flex-1 p-3">

        <div className="map-frame h-full">

          {(history?.trajectory?.length ?? 0) >= 2 && (
            <div className="map-mode-toggle">

              <button
                className={
                  showRoutes ? '' : 'active'
                }
                onClick={() =>
                  setShowRoutes(false)
                }
              >
                <GitCommitHorizontal
                  size={13}
                />

                Trajectory
              </button>


              <button
                className={
                  showRoutes ? 'active' : ''
                }
                onClick={() =>
                  setShowRoutes(true)
                }
              >
                <Route size={13} />

                Possible Routes
              </button>

            </div>
          )}


          <MapView
            trajectory={
              trajectorySlice.length >= 2
                ? trajectorySlice
                : history?.trajectory
            }

            trajectoryLabel={
              displayIdentifier ?? undefined
            }

            legs={
              trajectorySlice.length >= 2
                ? history?.legs.slice(
                    0,
                    trajectorySlice.length - 1
                  )
                : history?.legs
            }

            showRoutedPaths={showRoutes}
          />

        </div>

      </div>

    </div>
  )
}