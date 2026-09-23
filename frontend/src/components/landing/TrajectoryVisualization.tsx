import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useScrollReveal } from '../../lib/useScrollReveal'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { CAMERA_NODES, EXAMPLE_ROUTE } from '../../data/trajectoryExample'

const DRAW_DURATION_MS = 1800
const nodeById = Object.fromEntries(CAMERA_NODES.map(n => [n.id, n]))
const routeNodes = EXAMPLE_ROUTE.stops.map(s => nodeById[s.cameraId])
const routePath = routeNodes.map(n => `${n.x},${n.y}`).join(' L ')

// Cumulative distance fraction at each stop, used to time that stop's
// info-chip reveal proportionally to how far along the path it sits —
// a fixed timeline once triggered, not scroll-scrubbed.
function cumulativeFractions(nodes: { x: number; y: number }[]): number[] {
  const dists = nodes.slice(1).map((n, i) => Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y))
  const total = dists.reduce((a, b) => a + b, 0)
  let acc = 0
  return [0, ...dists.map(d => (acc += d) / total)]
}
const fractions = cumulativeFractions(routeNodes)

export default function TrajectoryVisualization() {
  const { ref: sectionRef, visible } = useScrollReveal<HTMLDivElement>(0.25)
  const prefersReducedMotion = usePrefersReducedMotion()
  const pathRef = useRef<SVGPathElement>(null)
  const [pathLength, setPathLength] = useState(0)

  // Measured synchronously before paint so the initial "hidden" state
  // (transitions disabled below) renders with the real path length, not 0.
  useLayoutEffect(() => {
    if (pathRef.current) setPathLength(pathRef.current.getTotalLength())
  }, [])

  // Transitions stay off for the initial mount paint, then switch on one
  // tick later — otherwise the very first style commit (measuring pathLength,
  // going from the default computed dashoffset to the real hidden value) gets
  // caught by the transition and animates on load instead of only on reveal.
  const [transitionsEnabled, setTransitionsEnabled] = useState(false)
  useEffect(() => setTransitionsEnabled(true), [])

  const drawn = visible || prefersReducedMotion
  const animate = transitionsEnabled && !prefersReducedMotion

  return (
    <section id="trajectory" className="px-6 md:px-10 py-24 md:py-32">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl mb-14 md:mb-16">
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--landing-ink-faint)' }}>
            LIVE TRAJECTORY
          </div>
          <h2 className="text-[18px] mb-4">Watching a route get reconstructed</h2>
          <p className="text-[13px]" style={{ color: 'var(--landing-ink-soft)' }}>
            Plate <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{EXAMPLE_ROUTE.plate}</code> was
            read by the pipeline at three different cameras during a real ingestion run — not simulated,
            not from the demo seed script. This is that match, replayed.
          </p>
        </div>

        <div ref={sectionRef}>
          {/* Floating 3D stage: the map itself tilts into an isometric-style
              view (static CSS transform, not cursor/scroll-linked parallax)
              and settles into place on the same reveal that draws the route
              — it reads as the diagram "coming online", not decoration. */}
          <div
            className="landing-map-stage flex justify-center py-10 md:py-16 px-4"
            style={{ background: 'var(--landing-surface)' }}
          >
            <div
              className={`landing-map-tilt ${drawn ? 'landing-map-tilt-settled' : ''}`}
              style={{ width: '100%', maxWidth: 720, transition: animate ? undefined : 'none' }}
            >
              <svg
                viewBox="0 0 800 560"
                className="w-full h-auto block border"
                style={{ borderColor: 'var(--landing-border)', background: 'var(--landing-bg)' }}
                role="img"
                aria-label="Map of camera network with the example route highlighted"
              >
                {/* Context: the rest of the camera network, dim */}
                {CAMERA_NODES.filter(n => !routeNodes.includes(n)).map(n => (
                  <circle key={n.id} cx={n.x} cy={n.y} r={4} fill="var(--landing-ink-faint)" opacity={0.5} />
                ))}

                {/* The route itself */}
                <path
                  ref={pathRef}
                  d={`M ${routePath}`}
                  fill="none"
                  stroke="var(--landing-accent)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: pathLength,
                    strokeDashoffset: drawn ? 0 : pathLength,
                    transition: animate ? `stroke-dashoffset ${DRAW_DURATION_MS}ms ease` : 'none',
                  }}
                />

                {routeNodes.map((n, i) => (
                  <g key={n.id}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={7}
                      fill="var(--landing-bg)"
                      stroke="var(--landing-ink)"
                      strokeWidth={2}
                      style={{
                        opacity: drawn ? 1 : 0,
                        transition: animate ? `opacity 300ms ease` : 'none',
                        transitionDelay: animate ? `${fractions[i] * DRAW_DURATION_MS}ms` : '0ms',
                      }}
                    />
                    <text
                      x={n.x}
                      y={n.y - 14}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--landing-ink)"
                      style={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        opacity: drawn ? 1 : 0,
                        transition: prefersReducedMotion ? 'none' : `opacity 300ms ease`,
                        transitionDelay: drawn && !prefersReducedMotion ? `${fractions[i] * DRAW_DURATION_MS}ms` : '0ms',
                      }}
                    >
                      {n.name}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          {/* Per-stop data readout, staggered on the same timeline as the draw-on */}
          <div className="grid grid-cols-1 md:grid-cols-3 border" style={{ borderColor: 'var(--landing-border)' }}>
            {EXAMPLE_ROUTE.stops.map((stop, i) => {
              const node = nodeById[stop.cameraId]
              return (
                <div
                  key={stop.cameraId}
                  className="p-5 md:p-6 border-b md:border-b-0 md:border-r last:border-r-0"
                  style={{
                    borderColor: 'var(--landing-border)',
                    opacity: drawn ? 1 : 0,
                    transform: drawn ? 'translateY(0)' : 'translateY(8px)',
                    transition: animate ? 'opacity 400ms ease, transform 400ms ease' : 'none',
                    transitionDelay: animate ? `${fractions[i] * DRAW_DURATION_MS}ms` : '0ms',
                  }}
                >
                  <div className="text-xs tracking-wide mb-2" style={{ color: 'var(--landing-ink-faint)' }}>
                    STOP {i + 1} · {node.name}
                  </div>
                  <div
                    className="text-[13px] font-bold mb-1"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {EXAMPLE_ROUTE.plate}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--landing-ink-soft)' }}>
                    OCR confidence {(stop.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
