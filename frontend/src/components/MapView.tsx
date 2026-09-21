import { Fragment, useEffect, useState } from 'react'
import { MapContainer, CircleMarker, Popup, Polyline, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// leaflet.heat patches L.heatLayer onto the Leaflet namespace
import 'leaflet.heat'
// @maplibre/maplibre-gl-leaflet patches L.maplibreGL() onto the Leaflet namespace —
// used instead of <TileLayer> so the basemap renders from MapTiler's vector style
// (free tier) rather than server-rendered raster tiles (custom styles require a
// paid MapTiler plan to render as raster PNGs).
import 'maplibre-gl/dist/maplibre-gl.css'
import '@maplibre/maplibre-gl-leaflet'
import * as maplibregl from 'maplibre-gl'
// Vite doesn't recognize maplibre-gl's internal `new Worker(new URL(...))` call,
// so its worker script silently fails to bundle (the plain `?url` variant also
// fails — the worker imports a sibling chunk, maplibre-gl-shared.mjs, that a bare
// `?url` copy omits). Without the worker, MapLibre can only paint the style's flat
// "Background" layer — no vector data (roads/land/water) ever loads, since that
// parsing normally happens inside the worker. `?worker&url` routes it through
// Vite's worker pipeline instead, which bundles the worker as a self-contained
// chunk; must be set before any map is constructed.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
maplibregl.setWorkerUrl(maplibreWorkerUrl)
import { getCameras, getDensity, getLegRoute, type Camera, type CongestionEntry, type TrajectoryLeg, type LegRoute } from '../lib/api'
import { useCachedFetch } from '../lib/cache'
import TrafficSimulation, { type SimStats, type SelectedVehicleInfo } from './TrafficSimulation'

interface HeatmapOptions {
  radius?: number
  blur?: number
  max?: number
  gradient?: Record<number, string>
}

interface MapViewProps {
  trajectory?: [number, number][]
  trajectoryLabel?: string
  stopLabels?: { name: string; time: string; cameraId: string }[]  // one per trajectory point, for persistent on-map labels
  legs?: TrajectoryLeg[]           // direction/timing between trajectory waypoints
  highlightAlerts?: string[]       // camera_ids with active alerts
  onCameraClick?: (cam: Camera) => void
  congestion?: CongestionEntry[]   // when provided, color camera markers by congestion status
  showHeatmap?: boolean            // default true
  heatmapOptions?: HeatmapOptions  // override radius/blur/gradient for a more vivid look
  lightBasemap?: boolean           // use a normal-brightness basemap instead of the dark theme
  // 'default' renders MapTiler's India-compliant vector style as-is (used by
  // Dashboard/Analytics). 'command-center' keeps the same style/data but
  // recolors it to the muted dark-navy "smart-city command center" palette
  // (see applyCommandCenterPalette) — used by Vehicle Search. The other
  // values are legacy from before the MapTiler migration, kept only so
  // callers passing them don't need to change; they're accepted but no
  // longer read.
  basemapStyle?: 'default' | 'command-center' | 'satellite' | 'satellite-cyan' | 'satellite-amber' | 'satellite-green' | 'natgeo'
  showRoutedPaths?: boolean        // road-snapped routes + alternates vs a straight camera-to-camera line
  legStatuses?: LegStatus[]        // per-leg real status (from actual alerts), colors the segmented line
  stopStatuses?: LegStatus[]       // per-stop status, colors the camera marker at each trajectory point
  showTrajectoryLegend?: boolean   // legend box (Normal / Suspicious / Blacklisted / Camera / Direction)

  // ── Traffic simulation (client-side "digital twin", see TrafficSimulation.tsx) ──
  simulationActive?: boolean
  simulationBlacklistPlates?: string[]
  onSimulationStats?: (stats: SimStats) => void
  simSelectedVehicleId?: number | null
  onSimSelectVehicle?: (info: SelectedVehicleInfo | null, id: number | null) => void
  onSimSelectedVehicleTick?: (info: SelectedVehicleInfo) => void
  simFollowing?: boolean
}

const CONGESTION_COLOR: Record<string, string> = {
  heavy: '#E63946',
  moderate: '#FFB020',
  normal: '#22C55E',
}

export type LegStatus = 'normal' | 'suspicious' | 'blacklisted'

// Deep forest/olive green = the searched vehicle's own confirmed trajectory
// (deliberately NOT the #4F8A62 brand green used for UI chrome elsewhere —
// this is a distinct, darker hue so the route reads as data on the map, not
// as another piece of app furniture), amber = a suspicious (route-anomaly)
// segment of it, red = a blacklisted segment. Deliberately NOT cyan — cyan
// is reserved for camera infrastructure (CAMERA_COLOR below) so the two
// concepts never visually collide on the map. Only the affected leg takes
// the amber/red color — the rest of the route stays dark green.
export const LEG_STATUS_COLOR: Record<LegStatus, string> = {
  normal: '#0B5D3B',
  suspicious: '#FFB020',
  blacklisted: '#E63946',
}

// A slightly heavier stroke (not a dash pattern — the spec calls only for a
// color + glow change here) on non-normal legs, so they still read as
// "different" at a glance even before the color registers.
const LEG_STATUS_WEIGHT: Record<LegStatus, number> = {
  normal: 3.5,
  suspicious: 4,
  blacklisted: 4.5,
}
// Outer glow opacity per status — normal/suspicious/blacklisted each have
// their own spec'd glow strength (0.30 / 0.30 / 0.40).
const LEG_STATUS_GLOW_OPACITY: Record<LegStatus, number> = {
  normal: 0.3,
  suspicious: 0.3,
  blacklisted: 0.4,
}

// Camera network color — dark green, not cyan. Every stop marker uses this
// regardless of that stop's alert status (status is communicated by the
// route line and a small badge instead), so "green dot" always means "this
// is a camera" — deliberately the same dark green as the vehicle route
// (#0B5D3B), never the lighter #4F8A62 UI/brand green, so the map's data
// layer reads as one consistent "NAGARNETRA intelligence" hue distinct from
// the app chrome around it.
const CAMERA_COLOR = '#0B5D3B'

// Marker pinpointing the exact camera location of a plate sighting — i.e.
// the camera(s) actually associated with the searched vehicle. Clean
// geographic point (dark-green center, white ring), not a neon glow: a
// second, larger brand-green ring further out is what marks it as
// "selected" rather than a generic camera dot. Status is NOT communicated
// by recoloring the marker (that would collide with the green = camera /
// dark-green = trajectory / amber-red = alert color scheme); instead a
// blacklisted stop gets a small red alert badge, and the current (most
// recent) stop gets an entirely distinct white-center/gold-ring pulse so
// "this is where the vehicle is right now" is the single strongest point
// on the map.
function highlightIcon(status: LegStatus = 'normal', variant?: 'current') {
  if (variant === 'current') {
    return L.divIcon({
      className: 'trajectory-highlight-icon',
      html: `<div style="position:relative;width:22px;height:22px;">
        <div class="trajectory-current-pulse"></div>
        <div style="position:absolute;inset:2px;border-radius:50%;border:2.5px solid #FFD21F;box-shadow:0 0 10px rgba(255,210,31,0.35);"></div>
        <div style="position:absolute;inset:7px;border-radius:50%;background:#FFFFFF;box-shadow:0 0 6px rgba(255,255,255,0.8);"></div>
      </div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    })
  }

  const badge = status === 'blacklisted'
    ? `<div style="position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:#E63946;border:1.5px solid #FFFFFF;box-shadow:0 0 5px rgba(230,57,70,0.8);"></div>`
    : ''
  return L.divIcon({
    className: 'trajectory-highlight-icon',
    html: `<div style="position:relative;width:18px;height:18px;">
      <div style="position:absolute;inset:-4px;border-radius:50%;border:2px solid #4F8A62;opacity:0.55;"></div>
      <div style="position:absolute;inset:0;border-radius:50%;background:${CAMERA_COLOR};border:2px solid #FFFFFF;box-shadow:0 2px 5px rgba(7,19,15,0.2), 0 0 6px rgba(11,93,59,0.25);"></div>
      ${badge}
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

// A camera with an active (unresolved) alert — a genuinely live event, not
// just a data point — gets an expanding red ripple instead of a static dot,
// so "something is happening here right now" reads at a glance on the map.
function alertMarkerIcon() {
  return L.divIcon({
    className: 'camera-marker-icon',
    html: `<div class="camera-marker-dot alert" style="position:relative;">
      <div class="camera-marker-ripple"></div>
      <div class="camera-marker-ripple" style="animation-delay:0.6s"></div>
    </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

// Small chevron showing direction of travel — white and compact (just the
// "V" tip, not a full shaft) so a handful spaced along the dark-green route
// read as a subtle live-tracked flow rather than a cluttered arrow on every
// segment. In straight-line trajectory mode it's deliberately not colored by
// leg status (that distinction is already carried by the route line itself);
// in routed-path mode it takes a primary/possible variant so the arrows
// themselves echo which route they belong to.
const DIRECTION_ARROW_STROKE: Record<'primary' | 'possible', string> = {
  primary: '#FFFFFF',
  possible: '#FFD6EC',
}
function directionIcon(bearingDeg: number, variant: 'primary' | 'possible' = 'primary') {
  const stroke = DIRECTION_ARROW_STROKE[variant]
  return L.divIcon({
    className: 'direction-arrow-icon',
    html: `<div style="transform: rotate(${bearingDeg}deg); width: 16px; height: 16px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0 0 2px rgba(0,0,0,0.6));">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 14 L12 4 L18 14" />
      </svg>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

// ── Real heatmap layer using leaflet.heat ────────────────────────────────────
// leaflet.heat is a side-effect import that extends L with L.heatLayer().
// We create the layer imperatively inside a useMap() hook so it is always
// added to and removed from the correct map instance.
// Low -> medium -> high -> critical traffic-density scale, matching the
// rest of the app's intelligence palette instead of a generic rainbow
// scientific-heatmap gradient. Kept as solid colors (opacity is applied to
// the whole heat canvas below, not baked into these stops) so the ramp
// itself stays clean regardless of density.
const DEFAULT_HEATMAP_OPTIONS: Required<HeatmapOptions> = {
  radius: 35,
  blur: 25,
  max: 1.0,
  gradient: {
    0.0: '#7FBF8F',
    0.4: '#FFD166',
    0.7: '#FF9F1C',
    1.0: '#E63946',
  },
}
// The heatmap is context, not intelligence — it must stay visually under
// vehicles, routes and camera markers (spec: never let it overpower the
// trajectory), so it's capped to a low opacity on its own canvas rather
// than relying on the gradient's alpha alone.
const HEATMAP_CANVAS_OPACITY = 0.2

// ── India-compliant basemap via MapTiler's custom style ──────────────────────
// Same imperative useMap() pattern as HeatmapLayer below: MapLibre GL renders
// the vector style (which draws J&K/Ladakh per India's official depiction,
// configured in MapTiler's Map Designer) directly onto a canvas layer added
// to the Leaflet map — <TileLayer> can't be used here since that only knows
// how to fetch pre-rendered raster tile images, not vector styles. Road and
// water colors are left as the style's own (orange/amber roads, blue
// water) — only darkened as a whole via the .leaflet-tile-pane filter below.
// ── "Command center" palette — recolors MapTiler's real style layers via
// MapLibre's paint API (not a CSS filter) so the basemap hits the app-wide
// muted, realistic GIS look precisely rather than an approximation. A warm
// light palette to match the rest of the redesigned app (dark-navy was the
// prior iteration, before the whole frontend moved to a light identity with
// dark-green floating HUD cards on top of the map). Deliberately leaves
// "Country border" / "Disputed border" / "IN border (disputed)" completely
// untouched — that's the India-compliant boundary rendering this whole
// basemap exists for; recoloring or hiding it would undo that work.
const COMMAND_CENTER_TERRAIN = '#F1F3EE'
const COMMAND_CENTER_WATER = '#A9D4E8'
const COMMAND_CENTER_WATERWAY = '#9BCBE1'
const COMMAND_CENTER_PARK = '#DCE8D8'
const COMMAND_CENTER_HIGHWAY = '#A9B09F'
const COMMAND_CENTER_MAJOR_ROAD = '#B8BEB7'
const COMMAND_CENTER_MINOR_ROAD = '#D3D8D1'
const COMMAND_CENTER_ROAD_OUTLINE = '#9AA394'
// Only two tiers are actually applied (important vs everything else) —
// "secondary" isn't wired to its own layer-id set because this style's real
// layer names below "Capital city labels"/"City labels" aren't cleanly
// separable into secondary-vs-minor without guessing at IDs; "Place labels"
// in particular was deliberately excluded from the important tier earlier
// (it covers neighborhood-level labels too, not just towns, and rendering
// it too prominently was a real legibility bug). Every non-important label
// gets the more muted "minor" tone, which matches the "subdued labels"
// goal better than guessing which ones deserve the darker "secondary" tone.
const COMMAND_CENTER_LABEL = '#7A847E'
const COMMAND_CENTER_LABEL_IMPORTANT = '#34443B'
const COMMAND_CENTER_BUILDING = '#E7EBE5'

const CLUTTER_LAYER_IDS = new Set([
  'Accommodation', 'Food', 'Shopping', 'Sport', 'Religion', 'Tourism', 'Zoo',
  'Roller coaster', 'Roller coaster labels', 'Aerialway', 'Aerialway station',
  'Parking space special', 'Street furniture', 'Traffic light', 'Zebra crossing',
  'Tree', 'Tree name', 'Oneway',
])
const IMPORTANT_LABEL_IDS = new Set(['Capital city labels', 'City labels'])
const HIGHWAY_IDS = new Set(['Highway', 'Highway bridge', 'Highway ramp'])
const MAJOR_ROAD_IDS = new Set(['Major road', 'Major road bridge', 'Major road ramp'])

function applyCommandCenterPalette(glMap: maplibregl.Map) {
  for (const layer of glMap.getStyle()?.layers ?? []) {
    const id = layer.id

    if (id === 'Country border' || id === 'Disputed border' || id.includes('IN border')) continue

    if (CLUTTER_LAYER_IDS.has(id)) {
      glMap.setLayoutProperty(id, 'visibility', 'none')
      continue
    }
    if (id.startsWith('Sub border')) {
      if (layer.type === 'line') glMap.setPaintProperty(id, 'line-opacity', 0.25)
      continue
    }

    if (id === 'Background') {
      glMap.setPaintProperty(id, 'background-color', COMMAND_CENTER_TERRAIN)
    } else if (id === 'Water' || id === 'Water intermittent') {
      glMap.setPaintProperty(id, 'fill-color', COMMAND_CENTER_WATER)
    } else if (/river|stream|ferry/i.test(id) && layer.type === 'line') {
      glMap.setPaintProperty(id, 'line-color', COMMAND_CENTER_WATERWAY)
    } else if (/^(park|farmland|forest|grass|wood|vegetation|cemetery|pitch)$/i.test(id) && layer.type === 'fill') {
      glMap.setPaintProperty(id, 'fill-color', COMMAND_CENTER_PARK)
    } else if ((id === 'Building' || id === 'Residential' || id === 'Industrial' || id === 'Commercial') && layer.type === 'fill') {
      glMap.setPaintProperty(id, 'fill-color', COMMAND_CENTER_BUILDING)
    } else if (id === 'Building 3D' && layer.type === 'fill-extrusion') {
      glMap.setPaintProperty(id, 'fill-extrusion-color', COMMAND_CENTER_BUILDING)
    } else if (/outline/i.test(id) && (layer.type === 'line' || layer.type === 'fill')) {
      const prop = layer.type === 'line' ? 'line-color' : 'fill-color'
      glMap.setPaintProperty(id, prop, COMMAND_CENTER_ROAD_OUTLINE)
    } else if (layer.type === 'line' && /road|highway/i.test(id)) {
      const roadColor = HIGHWAY_IDS.has(id)
        ? COMMAND_CENTER_HIGHWAY
        : MAJOR_ROAD_IDS.has(id)
        ? COMMAND_CENTER_MAJOR_ROAD
        : COMMAND_CENTER_MINOR_ROAD
      glMap.setPaintProperty(id, 'line-color', roadColor)
    } else if (layer.type === 'symbol') {
      // Every label layer in this style carries a solid white text/icon
      // halo (for legibility against a light basemap) — on this dark
      // basemap that halo is what actually dominates the pixel, not the
      // text-color underneath it, so recoloring text-color alone left
      // every label reading as a bright white glow. Dropping the halo
      // width to 0 lets the muted text-color actually show.
      const paint = layer.paint as Record<string, unknown> | undefined
      if (!paint) continue
      const labelColor = IMPORTANT_LABEL_IDS.has(id) ? COMMAND_CENTER_LABEL_IMPORTANT : COMMAND_CENTER_LABEL
      if ('text-color' in paint) {
        glMap.setPaintProperty(id, 'text-color', labelColor)
        glMap.setPaintProperty(id, 'text-halo-width', 0)
      }
      if ('icon-color' in paint) {
        glMap.setPaintProperty(id, 'icon-color', labelColor)
        glMap.setPaintProperty(id, 'icon-halo-width', 0)
      }
    }
  }
}

function MapTilerVectorLayer({ styleUrl, commandCenter = false }: { styleUrl: string; commandCenter?: boolean }) {
  const map = useMap()

  useEffect(() => {
    const layer = L.maplibreGL({ style: styleUrl }).addTo(map)

    if (commandCenter) {
      const glMap = layer.getMaplibreMap()

      // The map paints tiles as soon as they arrive, continuously — by the
      // time the generic 'load' event fires, at least one frame has
      // already rendered with MapTiler's native bright colors (orange
      // roads, blue water), which is what showed up as a visible
      // light-then-dark flash on every page load. Fix: keep the canvas
      // hidden and recolor as early as the style's layers exist (usually
      // long before tiles render), then fade the canvas in already-muted.
      //
      // Deliberately NOT gated on isStyleLoaded() — this style's road-
      // shield sprite icons ('transportation:road_' etc.) log "could not
      // be loaded" and can leave isStyleLoaded() stuck false indefinitely,
      // which would leave the canvas permanently hidden (a real bug this
      // exact approach hit in testing). setPaintProperty only needs the
      // layer to exist in the style spec, not for sprites/sources to be
      // fully ready, so checking getStyle()?.layers directly is both
      // earlier and safer. 'load' stays as a guaranteed-to-fire fallback
      // (it's what the map reliably reached before this change) so the
      // canvas is never left hidden even if the early path never catches.
      const canvas = glMap.getCanvas()
      canvas.style.opacity = '0'
      canvas.style.transition = 'opacity 200ms ease'

      let revealed = false
      const reveal = () => {
        if (revealed) return
        revealed = true
        applyCommandCenterPalette(glMap)
        requestAnimationFrame(() => { canvas.style.opacity = '1' })
      }

      if (glMap.getStyle()?.layers?.length) {
        reveal()
      } else {
        const onStyleData = () => {
          if (!glMap.getStyle()?.layers?.length) return
          glMap.off('styledata', onStyleData)
          reveal()
        }
        glMap.on('styledata', onStyleData)
      }
      glMap.once('load', reveal)
    }

    return () => {
      map.removeLayer(layer)
    }
  }, [map, styleUrl, commandCenter])

  return null
}

function HeatmapLayer({ points, options }: { points: [number, number, number][]; options?: HeatmapOptions }) {
  const map = useMap()
  const merged = { ...DEFAULT_HEATMAP_OPTIONS, ...options }

  useEffect(() => {
    if (!points.length) return

    const heatLayer = (L as any).heatLayer(points, {
      radius: merged.radius,
      blur: merged.blur,
      maxZoom: 13,
      max: merged.max,
      gradient: merged.gradient,
    })

    heatLayer.addTo(map)
    const heatCanvas: HTMLCanvasElement | undefined = heatLayer._canvas
    if (heatCanvas) heatCanvas.style.opacity = String(HEATMAP_CANVAS_OPACITY)
    return () => {
      map.removeLayer(heatLayer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points, JSON.stringify(merged)])

  return null
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Road-snapped trajectory legs ─────────────────────────────────────────────
// A camera only confirms a plate was at that exact point at that exact time —
// not which road it took to the next camera. RoutedLegLine asks the backend
// (OSRM) for the most probable road route between two consecutive sightings,
// plus any genuinely distinct alternates, and renders all of them: the
// primary route styled the same as before (glow + dark casing + dashed
// orange), alternates as thin muted dashed lines underneath. If routing is
// ever unavailable (offline, rate-limited, still loading) it falls back to
// the original straight-line segment so the trajectory never disappears.
const _legRouteCache = new Map<string, Promise<LegRoute[]>>()

// Exactly two route identities, per the app-wide intelligence-color scheme:
// deep forest green = the selected vehicle's actual/primary path, pink =
// every other candidate path OSRM considered. Multiple alternates (when
// OSRM returns more than one) all render as the same pink — they're one
// semantic category ("possible route"), not competing distinct options.
export const ROUTE_PRIMARY_COLOR = '#0B5D3B'
export const ROUTE_POSSIBLE_COLOR = '#FF2D95'

function legCacheKey(from: [number, number], to: [number, number]): string {
  const r = (n: number) => n.toFixed(5)
  return `${r(from[0])},${r(from[1])}|${r(to[0])},${r(to[1])}`
}

// Standard initial-bearing (great-circle) formula — pure geometry on real
// route coordinates already returned by OSRM, not a data source of its own.
function computeBearing(from: [number, number], to: [number, number]): number {
  const lat1 = from[0] * Math.PI / 180
  const lat2 = to[0] * Math.PI / 180
  const dLng = (to[1] - from[1]) * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

// Evenly-spaced direction markers along a road-snapped path (as opposed to
// the single straight-line midpoint arrow used for the non-routed mode) —
// `count` small chevrons, skipped entirely for very short paths so a single
// short hop doesn't get a cluttered arrow on top of it.
function sampleRouteArrows(coords: [number, number][], count: number): { pos: [number, number]; bearing: number }[] {
  if (coords.length < 6 || count <= 0) return []
  const arrows: { pos: [number, number]; bearing: number }[] = []
  for (let k = 1; k <= count; k++) {
    const idx = Math.round((coords.length - 1) * (k / (count + 1)))
    const prevIdx = Math.max(0, idx - 1)
    const nextIdx = Math.min(coords.length - 1, idx + 1)
    if (prevIdx === nextIdx) continue
    arrows.push({ pos: coords[idx], bearing: computeBearing(coords[prevIdx], coords[nextIdx]) })
  }
  return arrows
}

function RoutedLegLine({
  from, to, onRouteStats,
}: {
  from: [number, number]
  to: [number, number]
  onRouteStats?: (stats: { count: number; primaryKm: number; primaryMin: number; possibleKm: number | null; possibleMin: number | null }) => void
}) {
  const [routes, setRoutes] = useState<LegRoute[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const key = legCacheKey(from, to)
    if (!_legRouteCache.has(key)) {
      _legRouteCache.set(key, getLegRoute(from[0], from[1], to[0], to[1]).catch(() => []))
    }
    _legRouteCache.get(key)!.then(r => {
      if (cancelled) return
      setRoutes(r)
      const primary = r.find(x => x.is_primary)
      const bestAlt = r.find(x => !x.is_primary)
      onRouteStats?.({
        count: r.length || 1,
        primaryKm: primary?.distance_km ?? 0,
        primaryMin: primary?.duration_min ?? 0,
        possibleKm: bestAlt?.distance_km ?? null,
        possibleMin: bestAlt?.duration_min ?? null,
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from[0], from[1], to[0], to[1]])

  const primary = routes?.find(r => r.is_primary)
  const alternates = routes?.filter(r => !r.is_primary) ?? []
  const primaryPositions = primary?.coords ?? [from, to]
  const firstAlt = alternates[0]

  return (
    <>
      {/* Possible route(s) — pink, dashed, held at ~80% visual intensity so
          the primary gold route stays visually dominant. */}
      {alternates.map((alt, i) => (
        <Fragment key={`alt-${i}`}>
          <Polyline positions={alt.coords} pathOptions={{ color: ROUTE_POSSIBLE_COLOR, weight: 9, opacity: 0.28, lineCap: 'round' }} interactive={false} />
          <Polyline positions={alt.coords} pathOptions={{ color: ROUTE_POSSIBLE_COLOR, weight: 3, opacity: 0.85, dashArray: '7 6', lineCap: 'round' }} interactive={false} />
        </Fragment>
      ))}
      {firstAlt && sampleRouteArrows(firstAlt.coords, 1).map((a, i) => (
        <Marker key={`arr-alt-${i}`} position={a.pos} icon={directionIcon(a.bearing, 'possible')} interactive={false} />
      ))}

      {/* Primary route — solid deep forest green, the strongest line on the map. */}
      <Polyline positions={primaryPositions} pathOptions={{ color: ROUTE_PRIMARY_COLOR, weight: 9, opacity: 0.3, lineCap: 'round' }} interactive={false} />
      <Polyline positions={primaryPositions} pathOptions={{ color: ROUTE_PRIMARY_COLOR, weight: 3.5, opacity: 1, lineCap: 'round' }} interactive={false} />
      {sampleRouteArrows(primaryPositions, 2).map((a, i) => (
        <Marker key={`arr-primary-${i}`} position={a.pos} icon={directionIcon(a.bearing, 'primary')} interactive={false} />
      ))}
    </>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

// Each leg (confirmed camera-to-camera hop) is colored by whether a real
// alert actually fired at its arrival stop — anomaly -> amber, blacklist
// hit -> red, otherwise the normal gold. Two-layer render per segment (soft
// outer glow + sharp inner core) — a "golden halo + bright golden route"
// look, restrained rather than an all-out neon glow.
function SegmentedTrajectoryLine({
  positions, statuses,
}: {
  positions: [number, number][]
  statuses: LegStatus[]
}) {
  return (
    <>
      {positions.slice(0, -1).map((pos, i) => {
        const status = statuses[i] ?? 'normal'
        const color = LEG_STATUS_COLOR[status]
        const weight = LEG_STATUS_WEIGHT[status]
        const glowOpacity = LEG_STATUS_GLOW_OPACITY[status]
        const seg: [number, number][] = [pos, positions[i + 1]]
        return (
          <Fragment key={i}>
            <Polyline positions={seg} pathOptions={{ color, weight: weight + 5.5, opacity: glowOpacity, lineCap: 'round' }} interactive={false} />
            <Polyline positions={seg} pathOptions={{ color, weight, opacity: 1, lineCap: 'round' }} interactive={false} />
          </Fragment>
        )
      })}
    </>
  )
}

export default function MapView({
  trajectory,
  trajectoryLabel,
  stopLabels,
  legs,
  highlightAlerts = [],
  onCameraClick,
  congestion,
  showHeatmap = true,
  heatmapOptions,
  lightBasemap = false,
  basemapStyle = 'default',
  showRoutedPaths = false,
  legStatuses = [],
  stopStatuses = [],
  showTrajectoryLegend = false,
  simulationActive = false,
  simulationBlacklistPlates = [],
  onSimulationStats,
  simSelectedVehicleId = null,
  onSimSelectVehicle,
  onSimSelectedVehicleTick,
  simFollowing = false,
}: MapViewProps) {
  // Per-leg route stats (route count + real OSRM distance/duration for the
  // primary path and the best alternate), keyed by leg index so each leg's
  // RoutedLegLine can report independently without clobbering the others —
  // aggregated below into the "Primary Route" / "Possible Route" info panel.
  // Reset whenever the trajectory or mode changes so a stale reading from a
  // previous search doesn't linger.
  const [legRouteStats, setLegRouteStats] = useState<Record<number, {
    count: number; primaryKm: number; primaryMin: number; possibleKm: number | null; possibleMin: number | null
  }>>({})
  useEffect(() => {
    setLegRouteStats({})
  }, [trajectory, showRoutedPaths])

  const legStatsList = Object.values(legRouteStats)
  const primaryRouteKm = legStatsList.reduce((sum, s) => sum + s.primaryKm, 0)
  const primaryRouteMin = legStatsList.reduce((sum, s) => sum + s.primaryMin, 0)
  const hasPossibleRoute = legStatsList.some(s => s.possibleKm != null)
  const possibleRouteKm = legStatsList.reduce((sum, s) => sum + (s.possibleKm ?? s.primaryKm), 0)
  const possibleRouteMin = legStatsList.reduce((sum, s) => sum + (s.possibleMin ?? s.primaryMin), 0)

  // Cached so switching pages and back doesn't re-fetch + re-render from an
  // empty map every time — this data changes slowly relative to a 20s TTL.
  const { data: cameras } = useCachedFetch('map:cameras', getCameras, 30000)
  const { data: density } = useCachedFetch('map:density24h', () => getDensity(24), 20000)

  const camerasList = cameras ?? []
  const densityList = density ?? []

  // Build density lookup by camera_id
  const densityMap: Record<string, number> = {}
  densityList.forEach(d => { densityMap[d.camera_id] = d.event_count })

  // Build congestion lookup by camera_id, if provided (Analytics "GIS" panel)
  const congestionMap: Record<string, CongestionEntry> = {}
  congestion?.forEach(c => { congestionMap[c.camera_id] = c })

  // Midpoint + bearing for each trajectory leg, used to drop a direction arrow
  // (skip legs with no meaningful movement — bearing_deg is null there)
  const legMarkers = (legs && trajectory && trajectory.length >= 2)
    ? legs.slice(0, trajectory.length - 1).flatMap((leg, i) => {
        if (leg.bearing_deg == null) return []
        const [lat1, lng1] = trajectory[i]
        const [lat2, lng2] = trajectory[i + 1]
        return [{
          pos: [(lat1 + lat2) / 2, (lng1 + lng2) / 2] as [number, number],
          bearing: leg.bearing_deg,
        }]
      })
    : []

  // Build heatmap point array: [lat, lng, intensity 0-1]
  const maxCount = Math.max(...densityList.map(d => d.event_count), 1)
  const heatPoints: [number, number, number][] = densityList.map(d => [
    d.lat,
    d.lng,
    Math.min(d.event_count / maxCount, 1),
  ])

  // Delhi center
  const center: [number, number] = [28.6139, 77.2090]

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      className={lightBasemap ? 'map-light-theme' : basemapStyle === 'command-center' ? 'map-command-center' : undefined}
    >
      <MapTilerVectorLayer
        styleUrl={`https://api.maptiler.com/maps/${import.meta.env.VITE_MAPTILER_STYLE_ID || '01a09471-e40d-74ac-b437-32d34209fd25'}/style.json?key=${import.meta.env.VITE_MAPTILER_KEY || 'KXVlZpvSDsmbvczfF0aU'}`}
        commandCenter={basemapStyle === 'command-center'}
      />

      {/* Smooth traffic-density heatmap overlay */}
      {showHeatmap && <HeatmapLayer points={heatPoints} options={heatmapOptions} />}

      {/* Camera markers — still visible on top of heatmap for clicking */}
      {camerasList.map(cam => {
        const count = densityMap[cam.camera_id] || 0
        const isAlert = highlightAlerts.includes(cam.camera_id)
        const camCongestion = congestionMap[cam.camera_id]

        const popup = (
          <Popup>
            <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '180px' }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#FFFFFF' }}>{cam.name}</div>
              <div style={{ color: '#A8C2B0', fontSize: 12, marginBottom: 4 }}>{cam.road_segment}</div>
              <div style={{ fontSize: 12, color: '#A8C2B0' }}>
                <span style={{ color: '#FFD21F', fontWeight: 600 }}>{count}</span> events (24h)
              </div>
              {camCongestion && (
                <div style={{ fontSize: 12, marginTop: 2, color: '#A8C2B0' }}>
                  Congestion: <span style={{ color: CONGESTION_COLOR[camCongestion.status], fontWeight: 600 }}>
                    {camCongestion.status.toUpperCase()} ({camCongestion.congestion_score.toFixed(2)}x)
                  </span>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#A8C2B0', marginTop: 4 }}>
                📍 {cam.lat.toFixed(4)}, {cam.lng.toFixed(4)}
              </div>
              {isAlert && (
                <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(230,57,70,0.18)', borderRadius: 4, color: '#FF8A94', fontSize: 12, fontWeight: 600 }}>
                  ⚠ ACTIVE ALERT
                </div>
              )}
            </div>
          </Popup>
        )

        // Active alerts get an animated ripple div-icon instead of a static
        // SVG circle — a camera with something happening right now should
        // not look the same on the map as one that's just idly logging
        // traffic. Everything else keeps the cheaper CircleMarker.
        if (isAlert) {
          return (
            <Marker
              key={cam.camera_id}
              position={[cam.lat, cam.lng]}
              icon={alertMarkerIcon()}
              zIndexOffset={900}
              eventHandlers={{ click: () => onCameraClick?.(cam) }}
            >
              {popup}
            </Marker>
          )
        }

        // Clean geographic point, not a glow: a solid dark-green (or
        // congestion-colored) fill with a crisp white border, no fill
        // transparency — reads as a marker sitting on the map rather than a
        // halo floating above it.
        const color = camCongestion ? (CONGESTION_COLOR[camCongestion.status] || CAMERA_COLOR) : CAMERA_COLOR
        const radius = camCongestion?.status === 'heavy' ? 11 : 8

        return (
          <CircleMarker
            key={cam.camera_id}
            center={[cam.lat, cam.lng]}
            radius={radius}
            pathOptions={{ color: '#FFFFFF', weight: 1.5, fillColor: color, fillOpacity: 0.95 }}
            eventHandlers={{ click: () => onCameraClick?.(cam) }}
          >
            {popup}
          </CircleMarker>
        )
      })}

      {/* Client-side traffic simulation overlay — see TrafficSimulation.tsx */}
      {simulationActive && camerasList.length >= 2 && (
        <TrafficSimulation
          cameras={camerasList}
          blacklistPlates={simulationBlacklistPlates}
          active={simulationActive}
          onStatsChange={onSimulationStats}
          selectedId={simSelectedVehicleId}
          onSelectVehicle={onSimSelectVehicle ?? (() => {})}
          onSelectedVehicleTick={onSimSelectedVehicleTick}
          following={simFollowing}
        />
      )}

      {/* Trajectory — highlight every sighted camera exactly, even a single one */}
      {trajectory && trajectory.length >= 1 && (
        <>
          {trajectory.length >= 2 && (
            showRoutedPaths
              ? trajectory.slice(0, -1).map((pos, i) => (
                  <RoutedLegLine
                    key={i}
                    from={pos}
                    to={trajectory[i + 1]}
                    onRouteStats={stats => setLegRouteStats(prev => ({ ...prev, [i]: stats }))}
                  />
                ))
              : <SegmentedTrajectoryLine positions={trajectory} statuses={legStatuses} />
          )}

          {/* Camera-icon marker pinpointing each sighted stop — always cyan
              (camera-network color); a blacklisted stop gets a small red
              badge instead of recoloring the whole marker. The last
              (current-location) stop is the one exception: a distinct
              white-center/gold-ring pulse, the single strongest point on
              the map. Only the first and last stops carry a permanent
              label — matches a clean ops-dashboard trajectory replay
              instead of stacking every sighting's label on top of each
              other in dense trajectories. Intermediate stops still show
              their label on hover. */}
          {trajectory.map((pos, idx) => {
            const status = stopStatuses[idx] ?? 'normal'
            const label = stopLabels?.[idx]
            const isOrigin = idx === 0
            const isCurrent = idx === trajectory.length - 1
            const isEndpoint = isOrigin || isCurrent
            const variant = isCurrent ? 'current' : undefined
            return (
              <Marker key={idx} position={pos} icon={highlightIcon(status, variant)} zIndexOffset={1000}>
                {label && (
                  <Tooltip
                    permanent={isEndpoint}
                    direction="right"
                    offset={[12, 0]}
                    className={`trajectory-stop-label status-${status}`}
                  >
                    <div className="trajectory-stop-label-name">{label.name}</div>
                    <div className="trajectory-stop-label-meta">{label.time} · {label.cameraId}</div>
                    {status === 'blacklisted' && <div className="trajectory-stop-label-alert">⚠ BLACKLIST ALERT</div>}
                    {isCurrent && <div className="trajectory-stop-label-meta">Current Location</div>}
                  </Tooltip>
                )}
                <Popup>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                    <strong>Stop #{idx + 1}</strong><br />
                    {trajectoryLabel}
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {/* Direction-of-travel arrows at each leg's midpoint — only in
              straight-line Trajectory mode. Their position is the midpoint
              of the camera-to-camera straight line, which only lies on the
              visible path when that's what's actually being drawn; in
              "Possible Routes" mode the road-snapped path curves away from
              that straight line, so the arrow would float off it. */}
          {!showRoutedPaths && legMarkers.map((m, idx) => (
            <Marker key={idx} position={m.pos} icon={directionIcon(m.bearing)} interactive={false} />
          ))}
        </>
      )}
    </MapContainer>
    {showTrajectoryLegend && trajectory && trajectory.length >= 2 && (
      <div className="map-trajectory-legend-box">
        <div className="map-trajectory-legend-title">Legend</div>
        <div className="map-trajectory-legend-row"><i style={{ background: LEG_STATUS_COLOR.normal }} /> Vehicle Route</div>
        <div className="map-trajectory-legend-row"><i style={{ background: LEG_STATUS_COLOR.suspicious }} /> Suspicious Segment</div>
        <div className="map-trajectory-legend-row"><i style={{ background: LEG_STATUS_COLOR.blacklisted }} /> Blacklisted Segment</div>
        <div className="map-trajectory-legend-row"><i className="map-trajectory-legend-camera" /> Camera Location</div>
        <div className="map-trajectory-legend-row"><i className="map-trajectory-legend-current" /> Current Vehicle</div>
        <div className="map-trajectory-legend-row"><i className="map-trajectory-legend-arrow" /> Direction of Movement</div>
      </div>
    )}
    {showRoutedPaths && trajectory && trajectory.length >= 2 && (
      <div className="map-route-legend">
        <div className="map-route-info-row">
          {/* Label text stays white rather than the route's own dark-green
              hex — #0B5D3B reads fine as a swatch chip but is far too low
              contrast as small text on this near-black card. */}
          <span className="map-route-info-label" style={{ color: '#FFFFFF' }}>
            <i style={{ background: ROUTE_PRIMARY_COLOR }} /> Vehicle Route
          </span>
          <span className="map-route-info-stats">
            {primaryRouteKm > 0
              ? `${primaryRouteKm.toFixed(1)} km · ${Math.round(primaryRouteMin)} min · ${trajectory.length} camera${trajectory.length === 1 ? '' : 's'}`
              : 'Calculating…'}
          </span>
        </div>
        {hasPossibleRoute && (
          <div className="map-route-info-row">
            <span className="map-route-info-label" style={{ color: ROUTE_POSSIBLE_COLOR }}>
              <i className="map-route-legend-dashed" style={{ color: ROUTE_POSSIBLE_COLOR }} /> Possible Route
            </span>
            <span className="map-route-info-stats">{possibleRouteKm.toFixed(1)} km · {Math.round(possibleRouteMin)} min</span>
          </div>
        )}
        <div className="map-route-info-row">
          <span className="map-route-info-label" style={{ color: '#B8C9BE' }}>
            <i className="map-trajectory-legend-camera" /> Camera Location
          </span>
          <span className="map-route-info-label" style={{ color: '#B8C9BE' }}>
            <i className="map-trajectory-legend-current" /> Current Vehicle
          </span>
        </div>
        <span className="map-route-legend-note">Camera sightings are confirmed; the road path between them is inferred.</span>
      </div>
    )}
    {simulationActive && (
      <div className="map-trajectory-legend-box map-sim-legend-box">
        <div className="map-trajectory-legend-title">Legend</div>
        <div className="map-trajectory-legend-row"><i className="map-trajectory-legend-camera" /> Camera Location</div>
        <div className="map-trajectory-legend-row"><i className="map-sim-legend-dot" style={{ background: '#0B5D3B' }} /> Normal Vehicle</div>
        <div className="map-trajectory-legend-row"><i className="map-sim-legend-dot" style={{ background: '#FFB020' }} /> Suspicious Vehicle</div>
        <div className="map-trajectory-legend-row"><i className="map-sim-legend-dot" style={{ background: '#E63946' }} /> Blacklisted Vehicle</div>
        <div className="map-trajectory-legend-row"><i className="map-trajectory-legend-current" /> Selected Vehicle</div>
        <div className="map-sim-legend-density-label">Traffic Density</div>
        <div className="map-sim-legend-density-bar" />
      </div>
    )}
    </div>
  )
}
