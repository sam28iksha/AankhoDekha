import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Search,
  AlertTriangle,
  Navigation,
  Gauge,
  Route,
  GitCommitHorizontal,
  Radar,
  Play,
  Pause,
  Car,
  ArrowRight,
  ArrowLeft,
  Fingerprint,
} from 'lucide-react'

import MapView, {
  type LegStatus,
  LEG_STATUS_COLOR,
} from '../components/MapView'

import RadarLoader from '../components/RadarLoader'

import {
  getVehicleHistory,
  getVehicleEntityHistory,
  searchPlates,
  getTopPlates,
  getAlerts,
  type VehicleHistory,
  type VehicleEntityHistory,
  type PlateEvent,
  type TrajectoryLeg,
  type PlateSearchResult,
  type AlertEntry,
} from '../lib/api'

import { format } from 'date-fns'


// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------

const ALERT_MATCH_WINDOW_MS = 5 * 60 * 1000

type SearchMode = 'plate' | 'vehicle'


// -----------------------------------------------------------------------------
// LEG CONNECTOR
// -----------------------------------------------------------------------------

function LegConnector({ leg }: { leg: TrajectoryLeg }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex flex-col items-center flex-shrink-0"
        style={{ width: 10 }}
      >
        <div className="timeline-dot-line" />
      </div>

      <div
        className="flex items-center gap-2 flex-wrap pb-2.5 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        {leg.direction && (
          <>
            <Navigation
              size={11}
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

        {leg.avg_speed_kmh != null && leg.avg_speed_kmh < 200 && (
  <span className="flex items-center gap-1">
    <Gauge size={10} />
    {leg.avg_speed_kmh} km/h
  </span>
)}
      </div>
    </div>
  )
}


// -----------------------------------------------------------------------------
// TIMELINE ROW
// -----------------------------------------------------------------------------

function TimelineRow({
  sighting,
  status,
  isLast,
}: {
  sighting: PlateEvent
  status: LegStatus
  isLast: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex flex-col items-center flex-shrink-0"
        style={{ width: 10 }}
      >
        <span
          className={`timeline-dot${isLast ? ' timeline-dot-current' : ''}`}
          style={{
            background: LEG_STATUS_COLOR[status],
          }}
        />

        {!isLast && <div className="timeline-dot-line" />}
      </div>

      <div className="flex-1 min-w-0 pb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-mono font-semibold"
            style={{ color: 'var(--accent-blue-light)' }}
          >
            {format(new Date(sighting.timestamp), 'HH:mm')}
          </span>

          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {sighting.camera_name}
          </span>
        </div>

        <div
          className="text-xs mt-0.5"
          style={{ color: 'var(--text-muted)' }}
        >
          Camera {sighting.camera_id}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {status === 'blacklisted' && (
            <span className="tag tag-red">
              <AlertTriangle size={10} />
              BLACKLIST ALERT
            </span>
          )}

          {status === 'suspicious' && (
            <span className="tag tag-red">
              <AlertTriangle size={10} />
              ANOMALY
            </span>
          )}

          {isLast && (
            <span className="tag tag-gray">
              Current Location
            </span>
          )}
        </div>
      </div>
    </div>
  )
}


// -----------------------------------------------------------------------------
// MAIN COMPONENT
// -----------------------------------------------------------------------------

export default function VehicleSearch() {

  // ---------------------------------------------------------------------------
  // SEARCH STATE
  // ---------------------------------------------------------------------------

  const [searchMode, setSearchMode] = useState<SearchMode>('plate')

  const [query, setQuery] = useState('')

  const [history, setHistory] = useState<VehicleHistory | null>(null)

  const [entityHistory, setEntityHistory] =
    useState<VehicleEntityHistory | null>(null)

  const [selectedVehicleId, setSelectedVehicleId] =
    useState<string | null>(null)

  const [showFullDetails, setShowFullDetails] =
    useState(false)

  // ---------------------------------------------------------------------------
  // COMMON STATE
  // ---------------------------------------------------------------------------

  const [plateAlerts, setPlateAlerts] =
    useState<AlertEntry[]>([])

  const [loading, setLoading] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [scrubberIndex, setScrubberIndex] =
    useState(0)

  const [showRoutes, setShowRoutes] =
    useState(false)

  // ---------------------------------------------------------------------------
  // SEARCH SUGGESTIONS
  // ---------------------------------------------------------------------------

  const [suggestions, setSuggestions] =
    useState<PlateSearchResult[]>([])

  const [suggestLoading, setSuggestLoading] =
    useState(false)

  const [suggestOpen, setSuggestOpen] =
    useState(false)

  const [activeSuggestion, setActiveSuggestion] =
    useState(-1)

  const [topPlatesCache, setTopPlatesCache] =
    useState<PlateSearchResult[] | null>(null)

  const searchBoxRef =
    useRef<HTMLDivElement | null>(null)

  const debounceRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)


  // ---------------------------------------------------------------------------
  // RESET RESULT STATE
  // ---------------------------------------------------------------------------

  const resetResults = () => {
    setHistory(null)
    setEntityHistory(null)
    setSelectedVehicleId(null)
    setPlateAlerts([])
    setScrubberIndex(0)
    setShowFullDetails(false)
    setShowRoutes(false)
  }


  // ---------------------------------------------------------------------------
  // SEARCH PLATE
  // ---------------------------------------------------------------------------

  const searchPlate = useCallback(
    async (plateOverride?: string) => {

      const plate = (plateOverride ?? query).trim()

      if (!plate) return

      setSearchMode('plate')
      setSuggestOpen(false)
      setLoading(true)
      setError(null)

      resetResults()

      try {

        const upper = plate.toUpperCase()

        const [data] = await Promise.all([
          getVehicleHistory(upper),

          getAlerts({
            plate_number: upper,
          })
            .then(setPlateAlerts)
            .catch(() => {}),
        ])

        setQuery(upper)
        setHistory(data)

      } catch (err: any) {

        setError(
          err?.response?.data?.detail ||
          'Vehicle search failed'
        )

      } finally {
        setLoading(false)
      }

    },
    [query],
  )


  // ---------------------------------------------------------------------------
  // SEARCH VEHICLE ENTITY
  // ---------------------------------------------------------------------------

  const searchVehicle = useCallback(
    async (vehicleIdOverride?: string) => {

      const vehicleId =
        (vehicleIdOverride ?? query).trim()

      if (!vehicleId) return

      setSearchMode('vehicle')
      setSuggestOpen(false)
      setLoading(true)
      setError(null)

      resetResults()

      try {

        const normalized =
          vehicleId.toUpperCase()

        const data =
          await getVehicleEntityHistory(normalized)

        setQuery(normalized)
        setSelectedVehicleId(normalized)
        setEntityHistory(data)

      } catch (err: any) {

        setError(
          err?.response?.data?.detail ||
          'Vehicle entity search failed'
        )

      } finally {
        setLoading(false)
      }

    },
    [query],
  )


  // ---------------------------------------------------------------------------
  // GENERIC SEARCH
  //
  // If the user explicitly selected Vehicle ID mode, use entity endpoint.
  // ---------------------------------------------------------------------------

  const search = useCallback(
    async (override?: string) => {

      if (searchMode === 'vehicle') {
        await searchVehicle(override)
      } else {
        await searchPlate(override)
      }

    },
    [
      searchMode,
      searchVehicle,
      searchPlate,
    ],
  )


  // ---------------------------------------------------------------------------
  // VEHICLE ID BUTTON
  // ---------------------------------------------------------------------------

  const selectVehicleEntity = (
    vehicleId: string,
  ) => {

    setQuery(vehicleId)

    setSearchMode('vehicle')

    searchVehicle(vehicleId)
  }


  // ---------------------------------------------------------------------------
  // RETURN TO PLATE VIEW
  // ---------------------------------------------------------------------------

  const returnToPlateView = () => {

    if (!history) return

    setSearchMode('plate')

    setSelectedVehicleId(null)

    setEntityHistory(null)

    setShowFullDetails(false)

    setQuery(history.plate_number)

    setScrubberIndex(0)
  }


  // ---------------------------------------------------------------------------
  // FULL DETAILS BUTTON
  // ---------------------------------------------------------------------------

  const handleFullDetails = () => {

    setShowFullDetails(true)

    setTimeout(() => {

      document
        .getElementById('vehicle-full-details')
        ?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })

    }, 50)
  }


  // ---------------------------------------------------------------------------
  // LIVE PLATE SUGGESTIONS
  // ---------------------------------------------------------------------------

  useEffect(() => {

    if (searchMode !== 'plate') return

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    const trimmed = query.trim()

    if (trimmed.length < 2) {

      setSuggestions([])

      if (topPlatesCache) {

        setSuggestions(topPlatesCache)

      } else {

        getTopPlates(8)
          .then(top => {

            setTopPlatesCache(top)

            setSuggestions(top)

          })
          .catch(() => {})

      }

      return
    }

    setSuggestLoading(true)

    debounceRef.current =
      setTimeout(() => {

        searchPlates(trimmed)
          .then(setSuggestions)
          .catch(() => setSuggestions([]))
          .finally(() =>
            setSuggestLoading(false)
          )

      }, 250)

    return () => {

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

    }

  }, [
    query,
    searchMode,
    topPlatesCache,
  ])


  // ---------------------------------------------------------------------------
  // CLOSE SEARCH DROPDOWN OUTSIDE CLICK
  // ---------------------------------------------------------------------------

  useEffect(() => {

    const onClick = (e: MouseEvent) => {

      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(
          e.target as Node
        )
      ) {
        setSuggestOpen(false)
      }

    }

    document.addEventListener(
      'mousedown',
      onClick,
    )

    return () =>
      document.removeEventListener(
        'mousedown',
        onClick,
      )

  }, [])


  // ---------------------------------------------------------------------------
  // SELECT SUGGESTION
  // ---------------------------------------------------------------------------

  const selectSuggestion = (
    plate: string,
  ) => {

    setQuery(plate)

    setSuggestOpen(false)

    searchPlate(plate)
  }


  // ---------------------------------------------------------------------------
  // KEYBOARD SEARCH
  // ---------------------------------------------------------------------------

  const handleKey = (
    e: React.KeyboardEvent,
  ) => {

    if (e.key === 'Escape') {

      setSuggestOpen(false)

      return
    }

    if (
      !suggestOpen ||
      suggestions.length === 0 ||
      searchMode === 'vehicle'
    ) {

      if (e.key === 'Enter') {
        search()
      }

      return
    }

    if (e.key === 'ArrowDown') {

      e.preventDefault()

      setActiveSuggestion(
        i =>
          (i + 1) %
          suggestions.length,
      )

    } else if (e.key === 'ArrowUp') {

      e.preventDefault()

      setActiveSuggestion(
        i =>
          i <= 0
            ? suggestions.length - 1
            : i - 1,
      )

    } else if (e.key === 'Enter') {

      if (
        activeSuggestion >= 0 &&
        activeSuggestion < suggestions.length
      ) {

        selectSuggestion(
          suggestions[activeSuggestion]
            .plate_number,
        )

      } else {

        search()

      }

    }

  }


  useEffect(() => {

    setActiveSuggestion(-1)

  }, [suggestions])


  // ---------------------------------------------------------------------------
  // PLAYBACK
  // ---------------------------------------------------------------------------

  const [playing, setPlaying] =
    useState(false)

  const [playbackSpeed, setPlaybackSpeed] =
    useState(1)


  const activeHistory:
    | VehicleHistory
    | VehicleEntityHistory
    | null =
      searchMode === 'vehicle'
        ? entityHistory
        : history


  useEffect(() => {

    if (
      !playing ||
      !activeHistory ||
      activeHistory.sightings.length < 2
    ) {
      return
    }

    const id = setInterval(() => {

      setScrubberIndex(i => {

        if (
          i >=
          activeHistory.sightings.length - 1
        ) {

          setPlaying(false)

          return i
        }

        return i + 1
      })

    }, 1100 / playbackSpeed)

    return () =>
      clearInterval(id)

  }, [
    playing,
    playbackSpeed,
    activeHistory,
  ])


  useEffect(() => {

    setPlaying(false)

  }, [
    history?.plate_number,
    selectedVehicleId,
  ])


  // ---------------------------------------------------------------------------
  // ACTIVE DISPLAY VALUES
  // ---------------------------------------------------------------------------

  const currentHistory =
    activeHistory


  const vehicleIds =
    history?.vehicle_ids?.length
      ? history.vehicle_ids
      : Array.from(
          new Set(
            history?.sightings
              ?.map(s => s.vehicle_id)
              .filter(
                (
                  id,
                ): id is string =>
                  Boolean(id),
              ) ?? [],
          ),
        )


  const platesObserved =
    entityHistory?.plates_observed ??
    []


  const vehicleType =
    entityHistory?.vehicle_type ??
    history?.sightings?.[0]?.vehicle_type ??
    'unknown'


  const vehicleColor =
    entityHistory?.color ??
    history?.sightings?.[0]?.color ??
    'unknown'


  // ---------------------------------------------------------------------------
  // TRAJECTORY
  // ---------------------------------------------------------------------------

  const trajectorySlice =
    currentHistory?.trajectory?.slice(
      0,
      scrubberIndex + 1,
    ) ?? []


  const currentSighting =
    currentHistory?.sightings?.[
      scrubberIndex
    ]


  // ---------------------------------------------------------------------------
  // ALERT STATUS
  // ---------------------------------------------------------------------------

  const fullStopStatuses: LegStatus[] =
    (currentHistory?.sightings ?? []).map(
      sighting => {

        const match =
          plateAlerts.find(alert =>

            alert.camera_id ===
              sighting.camera_id &&

            Math.abs(
              new Date(
                alert.timestamp,
              ).getTime() -
                new Date(
                  sighting.timestamp,
                ).getTime(),
            ) <
              ALERT_MATCH_WINDOW_MS,

          )

        if (
          match?.alert_type ===
          'blacklist_hit'
        ) {
          return 'blacklisted'
        }

        if (
          match?.alert_type ===
          'anomaly'
        ) {
          return 'suspicious'
        }

        return 'normal'
      },
    )


  const fullStopLabels =
    (currentHistory?.sightings ?? []).map(
      sighting => ({
        name: sighting.camera_name,
        time: format(
          new Date(
            sighting.timestamp,
          ),
          'HH:mm',
        ),
        cameraId:
          sighting.camera_id,
      }),
    )


  const fullLegStatuses:
    LegStatus[] =
      fullStopStatuses.slice(1)


  const isScrubbing =
    trajectorySlice.length >= 2 &&
    scrubberIndex <
      (currentHistory?.sightings.length ??
        0) -
        1


  const stopStatuses =
    isScrubbing
      ? fullStopStatuses.slice(
          0,
          scrubberIndex + 1,
        )
      : fullStopStatuses


  const stopLabels =
    isScrubbing
      ? fullStopLabels.slice(
          0,
          scrubberIndex + 1,
        )
      : fullStopLabels


  const legStatuses =
    isScrubbing
      ? fullLegStatuses.slice(
          0,
          scrubberIndex,
        )
      : fullLegStatuses


  // ---------------------------------------------------------------------------
  // DISPLAY ID
  // ---------------------------------------------------------------------------

  const mapLabel =
    searchMode === 'vehicle'
      ? selectedVehicleId ??
        entityHistory?.vehicle_id ??
        'Vehicle'
      : history?.plate_number


  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full overflow-hidden">

      {/* =====================================================================
          LEFT PANEL
          ===================================================================== */}

      <div
        className="w-96 flex flex-col flex-shrink-0 overflow-hidden"
        style={{
          background:
            'var(--bg-secondary)',
          borderRight:
            '1px solid var(--border)',
        }}
      >

        {/* -------------------------------------------------------------------
            SEARCH HEADER
            ------------------------------------------------------------------- */}

        <div
          className="p-4"
          style={{
            borderBottom:
              '1px solid var(--border)',
          }}
        >

          <div className="page-kicker">
            PLATE LOOKUP
          </div>

          <div className="page-title-sm mb-3">
            Vehicle Search &amp; Trajectory
          </div>


          {/* SEARCH MODE */}

          <div className="flex gap-1 mb-3">

            <button
              type="button"
              onClick={() => {
                setSearchMode('plate')
                setQuery('')
                setError(null)
                setSuggestOpen(false)
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background:
                  searchMode === 'plate'
                    ? 'var(--accent-blue)'
                    : 'var(--bg-card)',
                color:
                  searchMode === 'plate'
                    ? 'white'
                    : 'var(--text-muted)',
                border:
                  '1px solid var(--border)',
              }}
            >
              Plate Number
            </button>

            <button
              type="button"
              onClick={() => {
                setSearchMode('vehicle')
                setQuery('')
                setError(null)
                setSuggestOpen(false)
                setSuggestions([])
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1"
              style={{
                background:
                  searchMode === 'vehicle'
                    ? 'var(--accent-blue)'
                    : 'var(--bg-card)',
                color:
                  searchMode === 'vehicle'
                    ? 'white'
                    : 'var(--text-muted)',
                border:
                  '1px solid var(--border)',
              }}
            >
              <Fingerprint size={12} />
              Vehicle ID
            </button>

          </div>


          {/* SEARCH BOX */}

          <div
            className="flex gap-2"
            ref={searchBoxRef}
            style={{
              position: 'relative',
            }}
          >

            <div className="search-field">

              <Search
                size={15}
                className="search-field-icon"
              />

              <input
                id="vehicle-search-input"
                className="search-input"
                placeholder={
                  searchMode === 'plate'
                    ? 'e.g. DL01AB1234'
                    : 'e.g. V_1E5F2600'
                }
                value={query}
                onChange={e =>
                  setQuery(
                    e.target.value.toUpperCase(),
                  )
                }
                onFocus={() =>
                  setSuggestOpen(true)
                }
                onKeyDown={handleKey}
                autoComplete="off"
              />


              {/* PLATE SUGGESTIONS */}

              {searchMode === 'plate' &&
                suggestOpen &&
                (suggestions.length > 0 ||
                  suggestLoading) && (

                  <div
                    className="suggest-dropdown"
                    id="plate-suggest-dropdown"
                  >

                    {query.trim().length < 2 && (
                      <div className="suggest-dropdown-label">
                        <Radar size={11} />
                        FREQUENTLY SEEN
                      </div>
                    )}

                    {suggestLoading &&
                    suggestions.length === 0 ? (

                      <div className="suggest-dropdown-empty">
                        <RadarLoader size={14} />
                      </div>

                    ) : (

                      suggestions.map(
                        (suggestion, index) => (

                          <button
                            key={
                              suggestion.plate_number
                            }
                            type="button"
                            className={`suggest-row ${
                              index ===
                              activeSuggestion
                                ? 'active'
                                : ''
                            }`}
                            onMouseDown={e =>
                              e.preventDefault()
                            }
                            onClick={() =>
                              selectSuggestion(
                                suggestion.plate_number,
                              )
                            }
                          >

                            <span className="plate-badge text-xs">
                              {
                                suggestion.plate_number
                              }
                            </span>

                            <span className="suggest-row-count">
                              {
                                suggestion.sighting_count
                              }{' '}
                              sighting
                              {suggestion.sighting_count ===
                              1
                                ? ''
                                : 's'}
                            </span>

                          </button>

                        ),
                      )

                    )}

                  </div>
                )}

            </div>


            <button
              id="vehicle-search-btn"
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
              onClick={() => search()}
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


        {/* -------------------------------------------------------------------
            ERROR
            ------------------------------------------------------------------- */}

        {error && (

          <div
            className="mx-4 mt-4 p-3 rounded-lg text-sm"
            style={{
              background:
                'rgba(230,57,70,0.1)',
              border:
                '1px solid rgba(230,57,70,0.3)',
              color:
                'var(--accent-critical)',
            }}
          >
            {error}
          </div>

        )}


        {/* ===================================================================
            PLATE RESULT
            =================================================================== */}

        {history &&
          searchMode === 'plate' && (

          <div
            className="p-4"
            style={{
              borderBottom:
                '1px solid var(--border)',
            }}
          >

            <div className="page-kicker mb-2">
              VEHICLE DETAILS
            </div>


            <div className="flex items-center gap-3 mb-3">

              <div
                className="flex items-center justify-center flex-shrink-0 rounded-lg"
                style={{
                  width: 44,
                  height: 44,
                  background:
                    'var(--bg-card)',
                  border:
                    '1px solid var(--border)',
                }}
              >
                <Car
                  size={22}
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                />
              </div>


              <div className="min-w-0 flex items-center gap-2 flex-wrap">

                <span
                  className={`plate-badge ${
                    history.blacklisted
                      ? 'blacklisted'
                      : ''
                  }`}
                >
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


            {/* BASIC DETAILS */}

            <div className="flex flex-col gap-1.5 text-xs mb-3">

              <div className="flex items-center justify-between">

  <span
    style={{
      color: 'var(--text-muted)',
    }}
  >
    Status
  </span>

  <span
    className="font-semibold"
    style={{
      color:
        history.total_sightings === 0
          ? 'var(--text-muted)'
          : history.blacklisted
            ? 'var(--accent-red)'
            : 'var(--accent-green)',
    }}
  >
    {history.total_sightings === 0
      ? 'Not Found'
      : history.blacklisted
        ? 'Blacklisted'
        : 'Active'}
  </span>

</div>


              {history.last_seen && (
                <div className="flex items-center justify-between">

                  <span
                    style={{
                      color:
                        'var(--text-muted)',
                    }}
                  >
                    Last Seen
                  </span>

                  <span
                    className="font-semibold"
                    style={{
                      color:
                        'var(--text-primary)',
                    }}
                  >
                    {format(
                      new Date(
                        history.last_seen,
                      ),
                      'dd MMM HH:mm',
                    )}
                  </span>

                </div>
              )}


              <div className="flex items-center justify-between">

                <span
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  Total Detections
                </span>

                <span
                  className="font-semibold"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {history.total_sightings}
                </span>

              </div>

            </div>


            {/* BLACKLIST REASON */}

            {history.blacklisted &&
              history.blacklist_info && (

              <div
                className="p-2 rounded text-xs mb-3"
                style={{
                  background:
                    'rgba(230,57,70,0.1)',
                  border:
                    '1px solid rgba(230,57,70,0.2)',
                  color:
                    'var(--accent-critical)',
                }}
              >
                ⚠ Reason:{' '}
                {history.blacklist_info.reason}
              </div>

            )}


            {/* ASSOCIATED PHYSICAL VEHICLES */}

            {vehicleIds.length > 0 && (

              <div className="mb-3">

                <div
                  className="text-[10px] font-semibold mb-2"
                  style={{
                    color:
                      'var(--text-muted)',
                    letterSpacing:
                      '0.12em',
                  }}
                >
                  PHYSICAL VEHICLE ID
                </div>

                <div className="flex flex-wrap gap-2">

                  {vehicleIds.map(
                    vehicleId => (

                      <button
                        key={vehicleId}
                        type="button"
                        onClick={() =>
                          selectVehicleEntity(
                            vehicleId,
                          )
                        }
                        className="text-xs font-mono font-semibold px-2.5 py-1.5 rounded"
                        style={{
                          background:
                            'var(--bg-card)',
                          border:
                            '1px solid var(--accent-blue-light)',
                          color:
                            'var(--accent-blue-light)',
                          cursor:
                            'pointer',
                        }}
                      >
                        {vehicleId}
                      </button>

                    ),
                  )}

                </div>

              </div>

            )}


            {/* FULL DETAILS BUTTON */}

            {history.total_sightings > 0 && (

              <button
                type="button"
                className="text-xs font-semibold flex items-center gap-1"
                style={{
                  color:
                    'var(--accent-blue-light)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
                onClick={
                  handleFullDetails
                }
              >
                View Full Details
                <ArrowRight size={12} />
              </button>

            )}

          </div>

        )}


        {/* ===================================================================
            VEHICLE ENTITY HEADER
            =================================================================== */}

        {entityHistory &&
          searchMode === 'vehicle' && (

          <div
            className="p-4"
            style={{
              borderBottom:
                '1px solid var(--border)',
            }}
          >

            <button
              type="button"
              onClick={
                returnToPlateView
              }
              className="text-xs flex items-center gap-1 mb-3"
              style={{
                color:
                  'var(--accent-blue-light)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={12} />
              Back to Plate
            </button>


            <div className="page-kicker mb-2">
              PHYSICAL VEHICLE
            </div>


            <div className="flex items-center gap-3 mb-3">

              <div
                className="flex items-center justify-center flex-shrink-0 rounded-lg"
                style={{
                  width: 44,
                  height: 44,
                  background:
                    'var(--bg-card)',
                  border:
                    '1px solid var(--border)',
                }}
              >
                <Car
                  size={22}
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                />
              </div>


              <div className="min-w-0">

                <div
                  className="font-mono font-semibold text-sm"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {selectedVehicleId}
                </div>

                <div
                  className="text-xs mt-1"
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  {vehicleType} ·{' '}
                  {vehicleColor}
                </div>

              </div>

            </div>


            <div className="flex flex-col gap-1.5 text-xs">

              <div className="flex items-center justify-between">

                <span
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  Total Detections
                </span>

                <span
                  className="font-semibold"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {
                    entityHistory.total_sightings
                  }
                </span>

              </div>


              {entityHistory.first_seen && (
                <div className="flex items-center justify-between">

                  <span
                    style={{
                      color:
                        'var(--text-muted)',
                    }}
                  >
                    First Seen
                  </span>

                  <span
                    className="font-semibold"
                    style={{
                      color:
                        'var(--text-primary)',
                    }}
                  >
                    {format(
                      new Date(
                        entityHistory.first_seen,
                      ),
                      'dd MMM HH:mm',
                    )}
                  </span>

                </div>
              )}


              {entityHistory.last_seen && (
                <div className="flex items-center justify-between">

                  <span
                    style={{
                      color:
                        'var(--text-muted)',
                    }}
                  >
                    Last Seen
                  </span>

                  <span
                    className="font-semibold"
                    style={{
                      color:
                        'var(--text-primary)',
                    }}
                  >
                    {format(
                      new Date(
                        entityHistory.last_seen,
                      ),
                      'dd MMM HH:mm',
                    )}
                  </span>

                </div>
              )}

            </div>


            {/* PLATES OBSERVED */}

            {platesObserved.length > 0 && (

              <div className="mt-3">

                <div
                  className="text-[10px] font-semibold mb-2"
                  style={{
                    color:
                      'var(--text-muted)',
                    letterSpacing:
                      '0.12em',
                  }}
                >
                  PLATES OBSERVED
                </div>

                <div className="flex flex-wrap gap-2">

                  {platesObserved.map(
                    plate => (

                      <button
                        key={plate}
                        type="button"
                        onClick={() =>
                          searchPlate(
                            plate,
                          )
                        }
                        className="plate-badge text-xs"
                        style={{
                          cursor:
                            'pointer',
                        }}
                      >
                        {plate}
                      </button>

                    ),
                  )}

                </div>

              </div>

            )}

          </div>

        )}


        {/* ===================================================================
            FULL DETAILS
            =================================================================== */}

        {showFullDetails &&
          history &&
          searchMode === 'plate' && (

          <div
            id="vehicle-full-details"
            className="p-4"
            style={{
              borderBottom:
                '1px solid var(--border)',
              background:
                'rgba(255,255,255,0.015)',
            }}
          >

            <div className="flex items-center justify-between mb-3">

              <div className="page-kicker">
                FULL DETAILS
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowFullDetails(
                    false,
                  )
                }
                className="text-xs"
                style={{
                  color:
                    'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>

            </div>


            {/* PLATE */}

            <div className="mb-3">

              <div
                className="text-[10px] mb-1"
                style={{
                  color:
                    'var(--text-muted)',
                }}
              >
                REGISTRATION
              </div>

              <div className="flex items-center gap-2">

                <span className="plate-badge">
                  {history.plate_number}
                </span>

                {history.blacklisted && (
                  <span className="tag tag-red">
                    BLACKLISTED
                  </span>
                )}

              </div>

            </div>


            {/* PHYSICAL VEHICLES */}

            <div className="mb-3">

              <div
                className="text-[10px] mb-2"
                style={{
                  color:
                    'var(--text-muted)',
                }}
              >
                LINKED PHYSICAL VEHICLES
              </div>

              {vehicleIds.length > 0 ? (

                <div className="flex flex-col gap-2">

                  {vehicleIds.map(
                    vehicleId => (

                      <button
                        key={vehicleId}
                        type="button"
                        onClick={() =>
                          selectVehicleEntity(
                            vehicleId,
                          )
                        }
                        className="flex items-center justify-between px-3 py-2 rounded"
                        style={{
                          background:
                            'var(--bg-card)',
                          border:
                            '1px solid var(--border)',
                          cursor:
                            'pointer',
                        }}
                      >

                        <span className="flex items-center gap-2">

                          <Fingerprint
                            size={14}
                            style={{
                              color:
                                'var(--accent-blue-light)',
                            }}
                          />

                          <span
                            className="font-mono text-xs font-semibold"
                            style={{
                              color:
                                'var(--text-primary)',
                            }}
                          >
                            {vehicleId}
                          </span>

                        </span>

                        <ArrowRight
                          size={13}
                          style={{
                            color:
                              'var(--text-muted)',
                          }}
                        />

                      </button>

                    ),
                  )}

                </div>

              ) : (

                <div
                  className="text-xs"
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  No physical vehicle identity
                  is linked to this plate.
                </div>

              )}

            </div>


            {/* CAMERA HISTORY */}

            <div className="mb-3">

              <div
                className="text-[10px] mb-2"
                style={{
                  color:
                    'var(--text-muted)',
                }}
              >
                CAMERAS VISITED
              </div>

              <div className="flex flex-wrap gap-2">

                {history.cameras_visited.map(
                  camera => (

                    <span
                      key={camera}
                      className="tag tag-gray"
                    >
                      {camera}
                    </span>

                  ),
                )}

              </div>

            </div>


            {/* FIRST/LAST */}

            <div className="grid grid-cols-2 gap-2 text-xs">

              <div
                className="p-2 rounded"
                style={{
                  background:
                    'var(--bg-card)',
                  border:
                    '1px solid var(--border)',
                }}
              >

                <div
                  className="text-[10px] mb-1"
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  FIRST SEEN
                </div>

                <div
                  className="font-semibold"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {history.first_seen
                    ? format(
                        new Date(
                          history.first_seen,
                        ),
                        'dd MMM HH:mm:ss',
                      )
                    : '—'}
                </div>

              </div>


              <div
                className="p-2 rounded"
                style={{
                  background:
                    'var(--bg-card)',
                  border:
                    '1px solid var(--border)',
                }}
              >

                <div
                  className="text-[10px] mb-1"
                  style={{
                    color:
                      'var(--text-muted)',
                  }}
                >
                  LAST SEEN
                </div>

                <div
                  className="font-semibold"
                  style={{
                    color:
                      'var(--text-primary)',
                  }}
                >
                  {history.last_seen
                    ? format(
                        new Date(
                          history.last_seen,
                        ),
                        'dd MMM HH:mm:ss',
                      )
                    : '—'}
                </div>

              </div>

            </div>

          </div>

        )}


        {/* ===================================================================
            ROUTE TIMELINE
            =================================================================== */}

        <div
          id="route-timeline-card"
          className="flex-1 overflow-y-auto p-4"
        >

          {!currentHistory &&
            !loading && (

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
                {searchMode === 'plate'
                  ? 'Enter a license plate number'
                  : 'Enter a vehicle ID'}
              </div>

              <div className="text-xs mt-1">

                {searchMode === 'plate'
                  ? 'e.g. DL01AB1234'
                  : 'e.g. V_1E5F2600'}

              </div>

            </div>

          )}


          {currentHistory &&
            currentHistory.sightings
              .length > 0 && (

            <div className="page-kicker mb-3">
              ROUTE TIMELINE
            </div>

          )}


          {currentHistory?.sightings.map(
            (event, index) => (

              <div key={event.event_id}>

                <TimelineRow
                  sighting={event}
                  status={
                    fullStopStatuses[index] ??
                    'normal'
                  }
                  isLast={
                    index ===
                    currentHistory
                      .sightings.length -
                      1
                  }
                />

                {currentHistory.legs[index] && (
                  <LegConnector
                    leg={
                      currentHistory
                        .legs[index]
                    }
                  />
                )}

              </div>

            ),
          )}


          {currentHistory &&
            currentHistory.total_sightings ===
              0 && (

              <div
                className="text-center py-8"
                style={{
                  color:
                    'var(--text-muted)',
                }}
              >
                <div className="text-sm">
                  No sightings found.
                </div>
              </div>

            )}

        </div>

      </div>


      {/* =====================================================================
          MAP
          ===================================================================== */}

      <div className="flex-1 p-3">

        <div className="map-frame map-frame-amber h-full">

          {(
            currentHistory?.trajectory
              ?.length ?? 0
          ) >= 2 && (

            <div className="map-mode-toggle">

              <button
                className={
                  showRoutes
                    ? ''
                    : 'active'
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
                  showRoutes
                    ? 'active'
                    : ''
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
              trajectorySlice.length >=
              2
                ? trajectorySlice
                : currentHistory?.trajectory
            }

            trajectoryLabel={
              mapLabel
            }

            legs={
              trajectorySlice.length >=
              2
                ? currentHistory?.legs.slice(
                    0,
                    trajectorySlice.length -
                      1,
                  )
                : currentHistory?.legs
            }

            legStatuses={
              legStatuses
            }

            stopStatuses={
              stopStatuses
            }

            stopLabels={
              stopLabels
            }

            showRoutedPaths={
              showRoutes
            }

            basemapStyle="command-center"
          />


          {/* -----------------------------------------------------------------
              PLAYBACK
              ----------------------------------------------------------------- */}

          {currentHistory &&
            currentHistory.sightings
              .length > 1 && (

            <div className="playback-bar">

              <button
                id="playback-play-btn"
                className="playback-play-btn"
                onClick={() => {

                  if (
                    !playing &&
                    scrubberIndex >=
                      currentHistory
                        .sightings
                        .length -
                        1
                  ) {
                    setScrubberIndex(0)
                  }

                  setPlaying(
                    p => !p,
                  )

                }}
              >

                {playing ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}

              </button>


              <input
                id="playback-scrubber"
                type="range"
                min={0}
                max={
                  currentHistory
                    .sightings.length -
                    1
                }
                value={
                  scrubberIndex
                }
                onChange={e => {

                  setPlaying(false)

                  setScrubberIndex(
                    Number(
                      e.target.value,
                    ),
                  )

                }}
                className="playback-scrubber"
              />


              <span className="playback-time">

                {currentSighting
                  ? format(
                      new Date(
                        currentSighting.timestamp,
                      ),
                      'HH:mm:ss',
                    )
                  : '--:--:--'}

                {' / '}

                {format(
                  new Date(
                    currentHistory
                      .sightings[
                      currentHistory
                        .sightings
                        .length - 1
                    ].timestamp,
                  ),
                  'HH:mm:ss',
                )}

              </span>


              <select
                id="playback-speed"
                className="playback-speed-select"
                value={
                  playbackSpeed
                }
                onChange={e =>
                  setPlaybackSpeed(
                    Number(
                      e.target.value,
                    ),
                  )
                }
              >

                <option value={1}>
                  1x
                </option>

                <option value={2}>
                  2x
                </option>

                <option value={4}>
                  4x
                </option>

              </select>

            </div>

          )}

        </div>

      </div>

    </div>
  )
}