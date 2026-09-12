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
const FOLLOW_ZOOM_MIN = 14

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

        // Trails first (under the vehicle dots)
        for (const v of vehiclesRef.current) {
          if (v.trail.length < 2) continue
          const color = v.kind === 'blacklisted' ? '239,68,68' : v.kind === 'suspicious' ? '245,158,11' : '0,217,255'
          const trailPx = v.trail.map(([lat, lng]) => map.latLngToContainerPoint([lat, lng]))
          ctx.beginPath()
          ctx.moveTo(trailPx[0].x, trailPx[0].y)
          for (let i = 1; i < trailPx.length; i++) ctx.lineTo(trailPx[i].x, trailPx[i].y)
          ctx.lineTo(v.screenX, v.screenY)
          ctx.strokeStyle = `rgba(${color}, ${v.kind === 'normal' ? 0.22 : 0.4})`
          ctx.lineWidth = v.kind === 'normal' ? 1.5 : 2.2
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
        }

        // Vehicle dots
        for (const v of vehiclesRef.current) {
          const isSelected = selectedIdRef.current === v.id
          const color = v.kind === 'blacklisted' ? '#ef4444' : v.kind === 'suspicious' ? '#f59e0b' : '#38e5ff'
          const radius = v.kind === 'normal' ? 2.1 : 3
          if (isSelected) {
            ctx.beginPath()
            ctx.arc(v.screenX, v.screenY, radius + 6, 0, Math.PI * 2)
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'
            ctx.lineWidth = 1.5
            ctx.stroke()
          }
          ctx.beginPath()
          ctx.arc(v.screenX, v.screenY, radius, 0, Math.PI * 2)
          ctx.fillStyle = color
          if (v.kind !== 'normal' || isSelected) {
            ctx.shadowColor = color
            ctx.shadowBlur = 8
          } else {
            ctx.shadowBlur = 0
          }
          ctx.fill()
          ctx.shadowBlur = 0
        }

        // Detection pings — expanding rings at cameras just reached
        pingsRef.current = pingsRef.current.filter(p => now - p.startedAt < DETECTION_LIFETIME_MS)
        for (const p of pingsRef.current) {
          const t = (now - p.startedAt) / DETECTION_LIFETIME_MS
          const ppt = map.latLngToContainerPoint([p.lat, p.lng])
          ctx.beginPath()
          ctx.arc(ppt.x, ppt.y, 6 + t * 26, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(56, 229, 255, ${0.9 * (1 - t)})`
          ctx.lineWidth = 2.5 * (1 - t * 0.5)
          ctx.shadowColor = 'rgba(0, 217, 255, 0.8)'
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
