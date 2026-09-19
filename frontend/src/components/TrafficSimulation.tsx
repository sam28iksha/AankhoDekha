import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type L from 'leaflet'
import type { Camera } from '../lib/api'
import {
  type VehicleKind, type SimStats, type SelectedVehicleInfo,
  randomPlate, pickRoute, continueRoute, assignKinds,
} from '../lib/simTypes'
export type { SimStats, SelectedVehicleInfo } from '../lib/simTypes'

// ── A purely client-side "digital twin" traffic layer ───────────────────────
// The backend only ever records discrete camera sightings (a plate seen at
// a point in time) — it has no continuous vehicle-position data to render.
// This layer simulates plausible continuous movement between real camera
// coordinates so the map reads as "a city full of traffic" rather than a
// static set of pins. Nothing here is persisted or sent to the backend;
// it exists purely to make the live map feel alive.
//
// Rendered on a single <canvas> redrawn every animation frame rather than as
// individual Leaflet/React markers — a few hundred markers each going
// through React's reconciliation every frame would not stay smooth, but a
// canvas repaint of a few hundred small circles is effectively free.
//
// The population/route logic (randomPlate, pickRoute, continueRoute,
// assignKinds) lives in lib/simTypes.ts.

interface SimVehicle {
  id: number
  plate: string
  kind: VehicleKind
  route: Camera[]        // ordered stops, at least 2
  segIndex: number
  segProgress: number    // 0..1 along current segment
  speedPerMs: number      // progress units per ms
  // Trail is kept in lat/lng, not screen pixels — pixel positions go stale
  // the instant the map pans or zooms (e.g. while following a selected
  // vehicle), which would otherwise draw stray lines across the whole map
  // connecting a now-meaningless old pixel to the current one. Reprojected
  // fresh via latLngToContainerPoint every frame instead.
  trail: [number, number][]
  lastTrailSampleAt: number
  screenX: number
  screenY: number
  lastDetectedAt: number  // timestamp of the last camera arrival — drives a brief post-detection highlight
  dwellUntil: number      // while now < dwellUntil, the vehicle holds still at its current stop
}

interface DetectionPing {
  lat: number
  lng: number
  startedAt: number
}

const VEHICLE_COUNT = 180
const BLACKLIST_TARGET = 4
const SUSPICIOUS_TARGET = 8
const TRAIL_LENGTH = 9
const TRAIL_SAMPLE_MS = 140
const DETECTION_LIFETIME_MS = 900
const DETECTION_HIGHLIGHT_MS = 500 // how long a vehicle stays visually "flashed" right after a detection
const DWELL_CHANCE = 0.25          // fraction of camera arrivals that pause briefly, like a stop at an intersection
const DWELL_MIN_MS = 400
const DWELL_MAX_MS = 1300
const FOLLOW_ZOOM_MIN = 14

// Body / highlight-stroke / windshield colors per vehicle state. Selected
// overrides kind entirely (a tracked vehicle is white+gold regardless of
// whether it's also blacklisted/suspicious — it's the single most
// important thing on the map while tracked). Normal traffic is a distinctly
// MUTED green (#3F7050) — visibly different from both the camera network's
// darker #0B5D3B and the route line's #0B5D3B, so "car" never reads as the
// same visual weight as "camera" or "confirmed route" even though all three
// are technically green. Normal is also the only kind with a base opacity
// below 1 (applied where it's drawn) — everything else stays fully opaque
// so warnings and the tracked vehicle never compete with background traffic.
const CAR_COLORS: Record<'selected' | VehicleKind, { body: string; highlight: string; glass: string }> = {
  selected: { body: '#FFFFFF', highlight: '#FFD21F', glass: '#EAF2EC' },
  normal: { body: '#3F7050', highlight: '#4F8A62', glass: '#DCE8E1' },
  suspicious: { body: '#FFB020', highlight: '#FFD166', glass: '#FFF7D6' },
  blacklisted: { body: '#E63946', highlight: '#FF6B6B', glass: '#FFE5E5' },
}

// Normal traffic is background information, not something that should
// "pop" — kept subtle even with nothing selected (spec: opacity 0.45-0.65
// at rest), then dimmed further while something else is being tracked
// (0.25-0.4), matching the "only important events pop" visual rule.
const NORMAL_OPACITY_AT_REST = 0.55
const NORMAL_OPACITY_WHILE_TRACKING = 0.32
const SUSPICIOUS_OPACITY = 0.9

// A top-down car silhouette — rounded rear, tapered/rounded nose — traced
// once per vehicle per frame in local (rotated) coordinate space where +X
// is "forward." Still just canvas path commands (no new DOM/SVG elements),
// so drawing ~180 of these every frame costs about the same as the plain
// triangle it replaces.
function traceCarBody(ctx: CanvasRenderingContext2D, len: number, wid: number) {
  const hw = wid / 2
  const nose = len * 0.5
  const tail = -len * 0.5
  const r = Math.min(wid, len) * 0.24
  ctx.beginPath()
  ctx.moveTo(tail + r, -hw)
  ctx.lineTo(len * 0.08, -hw)
  ctx.quadraticCurveTo(nose, -hw, nose, -hw * 0.25)
  ctx.lineTo(nose, hw * 0.25)
  ctx.quadraticCurveTo(nose, hw, len * 0.08, hw)
  ctx.lineTo(tail + r, hw)
  ctx.quadraticCurveTo(tail, hw, tail, hw - r)
  ctx.lineTo(tail, -hw + r)
  ctx.quadraticCurveTo(tail, -hw, tail + r, -hw)
  ctx.closePath()
}

// Normal traffic's own size curve — smaller than before at every zoom
// level (spec: ~10-14px at normal zoom, 16-22px close), so the fleet reads
// as background density rather than a wall of equally-sized icons.
function normalLengthForZoom(zoom: number): number {
  return Math.max(7, Math.min(20, 7 + (zoom - 10) * 3.2))
}

// Suspicious/blacklisted/selected all scale off the same normal-traffic
// baseline so the size relationship holds at every zoom level, not just
// the default one — selected lands at 1.5-2x normal per spec.
const KIND_SIZE_MULTIPLIER: Record<'selected' | VehicleKind, number> = {
  normal: 1,
  suspicious: 1.2,
  blacklisted: 1.35,
  selected: 1.8,
}

export default function TrafficSimulation({
  cameras,
  blacklistPlates,
  active,
  onStatsChange,
  selectedId,
  onSelectVehicle,
  onSelectedVehicleTick,
  following,
}: {
  cameras: Camera[]
  blacklistPlates: string[]
  active: boolean
  onStatsChange?: (stats: SimStats) => void
  onSelectedVehicleTick?: (info: SelectedVehicleInfo) => void
  selectedId: number | null
  onSelectVehicle: (info: SelectedVehicleInfo | null, id: number | null) => void
  following: boolean
}) {
  const map = useMap()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const vehiclesRef = useRef<SimVehicle[]>([])
  const pingsRef = useRef<DetectionPing[]>([])
  const detectionCountRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number>(performance.now())
  const selectedIdRef = useRef<number | null>(selectedId)
  const followingRef = useRef<boolean>(following)
  const statsThrottleRef = useRef(0)

  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { followingRef.current = following }, [following])

  // ── Setup: canvas element + vehicle population ────────────────────────
  useEffect(() => {
    if (!active || cameras.length < 2) return

    const container = map.getContainer()
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.zIndex = '450' // above tiles/heatmap, below Leaflet controls (~700+) and popups
    // Deliberately non-interactive: this canvas is a plain sibling of
    // Leaflet's own map pane (not a descendant), so if it captured pointer
    // events it would silently swallow them before they ever reach camera
    // markers or the map's own drag handling underneath. Vehicle selection
    // is wired through Leaflet's own `map.on('click', ...)` below instead,
    // which only fires for clicks Leaflet itself didn't already claim (a
    // marker's own click handler stops propagation), so camera popups and
    // map dragging keep working exactly as before.
    canvas.style.pointerEvents = 'none'
    container.appendChild(canvas)
    canvasRef.current = canvas

    const resize = () => {
      const size = map.getSize()
      const dpr = window.devicePixelRatio || 1
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
      const ctx = canvas.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    map.on('resize', resize)

    // Build the initial vehicle population. A handful are pre-tagged
    // blacklisted (using real plate numbers from the actual blacklist when
    // available, so the demo ties back to real data) or suspicious.
    const kinds = assignKinds(VEHICLE_COUNT, BLACKLIST_TARGET, SUSPICIOUS_TARGET)

    let blacklistCursor = 0
    vehiclesRef.current = kinds.map((kind, i) => {
      const route = pickRoute(cameras, 2 + Math.floor(Math.random() * 3))
      const plate = kind === 'blacklisted' && blacklistPlates.length > 0
        ? blacklistPlates[blacklistCursor++ % blacklistPlates.length]
        : randomPlate()
      return {
        id: i,
        plate,
        kind,
        route,
        segIndex: 0,
        segProgress: Math.random(),
        speedPerMs: (0.00006 + Math.random() * 0.00007) * (kind === 'suspicious' ? 1.6 : 1),
        trail: [],
        lastTrailSampleAt: 0,
        screenX: 0,
        screenY: 0,
        lastDetectedAt: 0,
        dwellUntil: 0,
      }
    })
    detectionCountRef.current = 0

    return () => {
      map.off('resize', resize)
      canvas.remove()
      canvasRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, map, cameras.length])

  // ── Click-to-select (hit-test against last-drawn screen positions) ────
  // Wired through Leaflet's own map click event rather than a listener on
  // the canvas itself — see the pointer-events note above. A click that
  // lands on a real camera marker never reaches here (Leaflet markers stop
  // propagation on their own click), so this only ever runs for clicks on
  // open map area, exactly where a simulated vehicle would be.
  useEffect(() => {
    if (!active) return

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const x = e.containerPoint.x
      const y = e.containerPoint.y
      let nearest: SimVehicle | null = null
      let nearestDist = 14 // px hit-radius
      for (const v of vehiclesRef.current) {
        const d = Math.hypot(v.screenX - x, v.screenY - y)
        if (d < nearestDist) { nearest = v; nearestDist = d }
      }
      if (nearest) {
        const from = nearest.route[nearest.segIndex]
        const to = nearest.route[nearest.segIndex + 1] ?? from
        onSelectVehicle({
          id: nearest.id,
          plate: nearest.plate,
          kind: nearest.kind,
          fromCamera: from.name,
          toCamera: to.name,
          progressPct: Math.round(nearest.segProgress * 100),
        }, nearest.id)
      } else {
        onSelectVehicle(null, null)
      }
    }
    map.on('click', handleMapClick)
    return () => { map.off('click', handleMapClick) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, map])

  // ── Animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return

    const tick = (now: number) => {
      const dt = Math.min(now - lastFrameRef.current, 100) // clamp huge gaps (tab backgrounded)
      lastFrameRef.current = now
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')

      let selectedInfo: SelectedVehicleInfo | null = null

      for (const v of vehiclesRef.current) {
        // Holding still at a stop it just reached — a light "paused at an
        // intersection" behavior applied to a subset of arrivals, not every
        // vehicle at every stop (see DWELL_CHANCE below).
        if (now >= v.dwellUntil) {
          v.segProgress += v.speedPerMs * dt
          while (v.segProgress >= 1) {
            v.segProgress -= 1
            v.segIndex += 1
            if (v.segIndex >= v.route.length - 1) {
              const arrivedAt = v.route[v.route.length - 1]
              v.route = continueRoute(cameras, arrivedAt)
              v.segIndex = 0
            }
            // Arrived at a camera stop — a genuine "detection" moment.
            const camAt = v.route[v.segIndex]
            pingsRef.current.push({ lat: camAt.lat, lng: camAt.lng, startedAt: now })
            detectionCountRef.current += 1
            v.lastDetectedAt = now
            if (Math.random() < DWELL_CHANCE) {
              v.dwellUntil = now + DWELL_MIN_MS + Math.random() * (DWELL_MAX_MS - DWELL_MIN_MS)
              v.segProgress = 0
              break
            }
          }
        }

        const from = v.route[v.segIndex]
        const to = v.route[v.segIndex + 1] ?? from
        const lat = from.lat + (to.lat - from.lat) * v.segProgress
        const lng = from.lng + (to.lng - from.lng) * v.segProgress
        const pt = map.latLngToContainerPoint([lat, lng])
        v.screenX = pt.x
        v.screenY = pt.y

        if (now - v.lastTrailSampleAt > TRAIL_SAMPLE_MS) {
          v.trail.push([lat, lng])
          if (v.trail.length > TRAIL_LENGTH) v.trail.shift()
          v.lastTrailSampleAt = now
        }

        if (selectedIdRef.current === v.id) {
          selectedInfo = {
            id: v.id, plate: v.plate, kind: v.kind,
            fromCamera: from.name, toCamera: to.name,
            progressPct: Math.round(v.segProgress * 100),
          }
        }
      }

      // Follow the selected vehicle without fighting a manual drag — only
      // recenter while `following` is true, and skip the zoom-in itself.
      if (selectedInfo && followingRef.current) {
        const v = vehiclesRef.current.find(x => x.id === selectedInfo!.id)
        if (v) {
          const from = v.route[v.segIndex]
          const to = v.route[v.segIndex + 1] ?? from
          const lat = from.lat + (to.lat - from.lat) * v.segProgress
          const lng = from.lng + (to.lng - from.lng) * v.segProgress
          const targetZoom = Math.max(map.getZoom(), FOLLOW_ZOOM_MIN)
          map.setView([lat, lng], targetZoom, { animate: false })
        }
      }

      if (ctx && canvas) {
        const dpr = window.devicePixelRatio || 1
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

        const hasSelection = selectedIdRef.current != null

        // Trails — deliberately skipped for ordinary normal traffic (spec:
        // "no prominent individual route" for background vehicles; showing
        // 150+ breadcrumb trails was a big part of the original clutter).
        // Kept, modestly, for suspicious/blacklisted/selected only.
        for (const v of vehiclesRef.current) {
          if (v.trail.length < 2) continue
          const isSelected = selectedIdRef.current === v.id
          if (v.kind === 'normal' && !isSelected) continue
          const color = v.kind === 'blacklisted' ? '230,57,70' : v.kind === 'suspicious' ? '255,176,32' : '11,93,59'
          const dim = hasSelection && !isSelected ? 0.4 : 1
          const trailPx = v.trail.map(([lat, lng]) => map.latLngToContainerPoint([lat, lng]))
          ctx.beginPath()
          ctx.moveTo(trailPx[0].x, trailPx[0].y)
          for (let i = 1; i < trailPx.length; i++) ctx.lineTo(trailPx[i].x, trailPx[i].y)
          ctx.lineTo(v.screenX, v.screenY)
          ctx.strokeStyle = `rgba(${color}, ${0.4 * dim})`
          ctx.lineWidth = 2.2
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
        }

        // Vehicle markers — a small top-down car silhouette rotated to face
        // the direction of travel (rather than a plain dot or triangle), so
        // the map reads as actual moving traffic. Heading is derived from
        // the straight-line direction of the current segment; for the
        // short hops between adjacent cameras at city zoom levels, treating
        // lat/lng deltas as locally linear on screen is accurate enough for
        // a marker's rotation without the cost of re-projecting two more
        // points per vehicle per frame. Size scales with the map's current
        // zoom (computed once per frame, not per vehicle) so cars stay
        // small at city-wide zoom and only grow once zoomed in close — and
        // scales again per kind (normal < suspicious < blacklisted <
        // selected), so the visual hierarchy holds at every zoom level.
        const zoom = map.getZoom()
        const normalLen = normalLengthForZoom(zoom)

        const drawVehicle = (v: SimVehicle, isSelected: boolean) => {
          const from = v.route[v.segIndex]
          const to = v.route[v.segIndex + 1] ?? from
          const heading = Math.atan2(-(to.lat - from.lat), to.lng - from.lng)
          const detectFrac = Math.max(0, 1 - (now - v.lastDetectedAt) / DETECTION_HIGHLIGHT_MS)
          const colors = isSelected ? CAR_COLORS.selected : CAR_COLORS[v.kind]
          const sizeKey = isSelected ? 'selected' : v.kind

          // Subtle, purely cosmetic size jitter (not a fabricated "vehicle
          // type" — there's no such data to draw on) so the fleet doesn't
          // read as identical clones.
          const sizeVariant = 0.92 + (v.id % 5) * 0.04
          const len = normalLen * KIND_SIZE_MULTIPLIER[sizeKey] * sizeVariant * (1 + detectFrac * 0.15)
          const wid = len * 0.42

          // Normal traffic is background information at all times (dimmer
          // still while something else is being tracked); suspicious sits
          // at a fixed 0.9; blacklisted and the selected vehicle are always
          // fully opaque so a real warning never fades into the crowd.
          const opacity = isSelected || v.kind === 'blacklisted'
            ? 1
            : v.kind === 'suspicious'
            ? SUSPICIOUS_OPACITY
            : (hasSelection ? NORMAL_OPACITY_WHILE_TRACKING : NORMAL_OPACITY_AT_REST)

          ctx.save()
          ctx.globalAlpha = opacity
          ctx.translate(v.screenX, v.screenY)
          ctx.rotate(heading)

          // Soft shadow underneath, separating the car from the pale map.
          ctx.beginPath()
          ctx.ellipse(0, 0, len * 0.52, wid * 0.58, 0, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
          ctx.fill()

          if (isSelected) {
            // Expanding, fading ring — scale 1 -> 1.25, opacity 0.8 -> 0,
            // ~1.2s per cycle — rather than a continuous breathing glow, so
            // it reads as a deliberate pulse and not a constant flash.
            const cycleMs = 1200
            const t = (now % cycleMs) / cycleMs
            ctx.beginPath()
            ctx.arc(0, 0, len * 0.62 * (1 + 0.25 * t), 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(255, 210, 31, ${0.8 * (1 - t)})`
            ctx.lineWidth = 1.6
            ctx.stroke()
          } else if (v.kind === 'suspicious' || v.kind === 'blacklisted') {
            // A thin static ring (amber/red) — enough to say "not ordinary
            // traffic" without the pulsing treatment reserved for the
            // vehicle actually being tracked.
            ctx.beginPath()
            ctx.arc(0, 0, len * 0.58, 0, Math.PI * 2)
            ctx.strokeStyle = v.kind === 'blacklisted' ? 'rgba(230,57,70,0.55)' : 'rgba(255,176,32,0.5)'
            ctx.lineWidth = 1.1
            ctx.stroke()
          }

          traceCarBody(ctx, len, wid)
          ctx.fillStyle = colors.body
          if (isSelected || v.kind !== 'normal' || detectFrac > 0) {
            ctx.shadowColor = isSelected ? 'rgba(255,210,31,0.6)' : colors.body
            ctx.shadowBlur = isSelected ? 6 : 3 + detectFrac * 6
          } else {
            ctx.shadowBlur = 0
          }
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.strokeStyle = colors.highlight
          ctx.lineWidth = isSelected ? 1.1 : 0.7
          ctx.stroke()

          // Windshield + headlights — skipped below a size floor where
          // they'd just be sub-pixel noise.
          if (len > 10) {
            ctx.beginPath()
            ctx.ellipse(len * 0.1, 0, len * 0.17, wid * 0.32, 0, 0, Math.PI * 2)
            ctx.fillStyle = colors.glass
            ctx.fill()
          }
          if (len > 13) {
            ctx.fillStyle = colors.highlight
            const lampR = Math.max(0.8, len * 0.045)
            ctx.beginPath()
            ctx.arc(len * 0.47, -wid * 0.22, lampR, 0, Math.PI * 2)
            ctx.arc(len * 0.47, wid * 0.22, lampR, 0, Math.PI * 2)
            ctx.fill()
          }

          ctx.restore()

          // Small "!" flag above blacklisted vehicles — drawn in screen
          // space (not rotated with the car) so it always reads upright.
          if (v.kind === 'blacklisted' && !isSelected) {
            ctx.save()
            ctx.globalAlpha = opacity
            ctx.translate(v.screenX, v.screenY - len * 0.85)
            ctx.beginPath()
            ctx.moveTo(-3.2, 4); ctx.lineTo(3.2, 4); ctx.lineTo(0, -5.5)
            ctx.closePath()
            ctx.fillStyle = '#E63946'
            ctx.fill()
            ctx.fillStyle = '#FFFFFF'
            ctx.font = 'bold 6px sans-serif'
            ctx.textAlign = 'center'
            ctx.fillText('!', 0, 2.4)
            ctx.restore()
          }
        }

        // Layer order: normal traffic first (the "background"), then
        // suspicious, then blacklisted, then the selected vehicle last —
        // so warnings and the tracked vehicle always sit visually on top of
        // ordinary traffic no matter where they fall in the vehicle array.
        const selId = selectedIdRef.current
        for (const v of vehiclesRef.current) if (v.kind === 'normal' && v.id !== selId) drawVehicle(v, false)
        for (const v of vehiclesRef.current) if (v.kind === 'suspicious' && v.id !== selId) drawVehicle(v, false)
        for (const v of vehiclesRef.current) if (v.kind === 'blacklisted' && v.id !== selId) drawVehicle(v, false)
        if (selId != null) {
          const sel = vehiclesRef.current.find(v => v.id === selId)
          if (sel) drawVehicle(sel, true)
        }

        // Detection pings — a subtle cyan expanding ring at the camera a
        // vehicle just reached, distinct from both the (dark-green) camera
        // dot and any vehicle color, so "a detection just happened here"
        // reads as its own transient event rather than blending into
        // either. Never a permanent glow — it fades out and is gone.
        pingsRef.current = pingsRef.current.filter(p => now - p.startedAt < DETECTION_LIFETIME_MS)
        for (const p of pingsRef.current) {
          const t = (now - p.startedAt) / DETECTION_LIFETIME_MS
          const ppt = map.latLngToContainerPoint([p.lat, p.lng])
          ctx.beginPath()
          ctx.arc(ppt.x, ppt.y, 6 + t * 26, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(0, 184, 217, ${0.9 * (1 - t)})`
          ctx.lineWidth = 2.5 * (1 - t * 0.5)
          ctx.shadowColor = 'rgba(0, 184, 217, 0.8)'
          ctx.shadowBlur = 6
          ctx.stroke()
          ctx.shadowBlur = 0
        }
      }

      // Stats + tracked-vehicle callbacks throttled to ~4/sec — no need to
      // re-render React on every animation frame just for sidebar text.
      if (now - statsThrottleRef.current > 250) {
        statsThrottleRef.current = now
        onStatsChange?.({
          active: vehiclesRef.current.length,
          blacklisted: vehiclesRef.current.filter(v => v.kind === 'blacklisted').length,
          suspicious: vehiclesRef.current.filter(v => v.kind === 'suspicious').length,
          detectionsThisSession: detectionCountRef.current,
        })
        if (selectedInfo) onSelectedVehicleTick?.(selectedInfo)
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    lastFrameRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, map, cameras])

  return null
}
