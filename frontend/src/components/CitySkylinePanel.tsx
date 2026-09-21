// Original, dense line-art cityscape — not a reproduction of any real
// monument or copyrighted illustration. Three depth layers (a faint distant
// skyline strip, a midground band of ordinary buildings, and a detailed
// foreground of heritage domes/arches/columns plus modern smart-city
// towers) built around one large central landmark — inspired by the
// *language* of Indian civic architecture (arches, onion domes, colonnades)
// without depicting any specific real structure. Wide and reasonably tall
// (viewBox 700x480) with ~20 distinct foreground/midground structures so
// the buildings themselves, not empty canvas, are what fills the panel.
//
// Bold variant: every stroke below is roughly 1.7-2x the original line-art
// weight, and detail lines (floors, columns, arches) run at higher opacity
// too, so the architecture reads as deliberate linework up close instead of
// fading into faint outline texture the way the original thin strokes did.

const ARCH_PRIMARY = '#2F6848'
const ARCH_HIGHLIGHT = '#3F8559'
const ARCH_DISTANT = 'rgba(47,104,72,0.42)'
const TECH_ACCENT = '#00B8D9'
const GROUND_Y = 440

// ── Background layer — a thin, low-detail strip suggesting a distant city
// behind the real composition. Heights are a fixed, hand-picked sequence
// (not Math.random()) so the illustration never re-shuffles on re-render.
const BG_HEIGHTS = [20, 32, 18, 38, 24, 34, 19, 29, 22, 36, 26, 21, 33, 17, 35, 25, 30, 20, 28, 23]
const BG_BUILDINGS = BG_HEIGHTS.map((h, i) => ({ x: 8 + i * 35, w: 21, h }))

// ── Midground layer — ordinary mid-rise buildings flanking the foreground
// hero structures, some with a simple dome for continuity with the
// heritage buildings in front of them.
const MIDGROUND: { x: number; w: number; h: number; dome?: boolean }[] = [
  { x: 8, w: 26, h: 90 },
  { x: 245, w: 22, h: 70, dome: true },
  { x: 432, w: 22, h: 70, dome: true },
  { x: 664, w: 26, h: 90 },
]

// ── Ground grid ticks — a very subtle "smart-city data grid" along the
// baseline, not a literal road.
const GRID_TICKS = Array.from({ length: 28 }, (_, i) => 8 + i * 25)

// Sensor-node dots scattered at mid-height — "small connected nodes," kept
// few and faint so the panel reads as architecture first, network second.
const NODE_DOTS: [number, number][] = [[110, 390], [590, 390], [230, 420], [470, 420], [350, 400]]

// ── Reusable building types (called at multiple x positions rather than
// hand-writing near-duplicate paths) ─────────────────────────────────────

function windowGridTower(x: number, w: number, h: number, opts: { pulse?: 'a' | 'b' } = {}) {
  const top = GROUND_Y - h
  const cx = x + w / 2
  const crownW = w * 0.55
  const crownH = h * 0.14
  const crownX = x + (w - crownW) / 2
  const crownTop = top - crownH
  const antennaTop = crownTop - h * 0.16
  const floors = [0.22, 0.42, 0.62, 0.82]
  return (
    <g key={`tower-${x}`} opacity={0.95}>
      <rect x={x} y={top} width={w} height={h} fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.8" />
      {floors.map((f, i) => (
        <line key={i} x1={x} y1={top + h * f} x2={x + w} y2={top + h * f} stroke={ARCH_PRIMARY} strokeWidth="1.3" opacity="0.65" />
      ))}
      <line x1={cx} y1={top} x2={cx} y2={GROUND_Y} stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.55" />
      <rect x={crownX} y={crownTop} width={crownW} height={crownH} fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="2.6" />
      <line x1={cx} y1={crownTop} x2={cx} y2={antennaTop} stroke={ARCH_HIGHLIGHT} strokeWidth="2.4" />
      {opts.pulse && (
        <circle cx={cx} cy={antennaTop - 4} r="3.2" fill={TECH_ACCENT} className={`skyline-pulse${opts.pulse === 'b' ? ' skyline-pulse-delay' : ''}`} />
      )}
    </g>
  )
}

function spireTower(x: number, w: number, h: number) {
  const top = GROUND_Y - h
  const cx = x + w / 2
  const spireTip = top - h * 0.22
  return (
    <g key={`spire-${x}`} opacity={0.9}>
      <rect x={x} y={top} width={w} height={h} fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.4" />
      <path d={`M ${x} ${top} L ${cx} ${spireTip} L ${x + w} ${top} Z`} fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="2.4" />
      <line x1={x} y1={top + h * 0.35} x2={x + w} y2={top + h * 0.35} stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />
      <line x1={x} y1={top + h * 0.65} x2={x + w} y2={top + h * 0.65} stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />
    </g>
  )
}

function domedBuilding(x: number, w: number, h: number) {
  const top = GROUND_Y - h
  const cx = x + w / 2
  const domeRy = w * 0.55
  const domeTop = top - domeRy
  const colOffset = w * 0.14
  return (
    <g key={`dome-${x}`} opacity={0.95}>
      <rect x={x} y={top} width={w} height={h} fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.6" />
      <path d={`M ${x} ${top} A ${w / 2} ${domeRy} 0 0 1 ${x + w} ${top}`} fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="2.8" />
      <line x1={cx} y1={domeTop + 4} x2={cx} y2={domeTop - 14} stroke={ARCH_HIGHLIGHT} strokeWidth="2.1" />
      <circle cx={cx} cy={domeTop - 17} r="1.9" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="1.8" />
      {/* columns flanking a small arch doorway */}
      <line x1={x + colOffset} y1={top + h * 0.15} x2={x + colOffset} y2={GROUND_Y} stroke={ARCH_PRIMARY} strokeWidth="1.4" opacity="0.75" />
      <line x1={x + w - colOffset} y1={top + h * 0.15} x2={x + w - colOffset} y2={GROUND_Y} stroke={ARCH_PRIMARY} strokeWidth="1.4" opacity="0.75" />
      <path d={`M ${cx - w * 0.16} ${GROUND_Y} A ${w * 0.16} ${h * 0.14} 0 0 1 ${cx + w * 0.16} ${GROUND_Y}`} fill="none" stroke={ARCH_PRIMARY} strokeWidth="1.8" opacity="0.9" />
      <line x1={x} y1={top + h * 0.5} x2={x + w} y2={top + h * 0.5} stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.55" />
    </g>
  )
}

function archedMidrise(x: number, w: number, h: number) {
  const top = GROUND_Y - h
  const archW = w / 3.4
  const archY = top + h * 0.32
  return (
    <g key={`arched-${x}`} opacity={0.9}>
      <rect x={x} y={top} width={w} height={h} fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.4" />
      {[0.18, 0.5, 0.82].map((f, i) => {
        const ax = x + w * f - archW / 2
        return <path key={i} d={`M ${ax} ${archY} A ${archW / 2} ${archW * 0.9} 0 0 1 ${ax + archW} ${archY}`} fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="1.8" opacity="0.9" />
      })}
      <line x1={x} y1={top} x2={x + w} y2={top} stroke={ARCH_PRIMARY} strokeWidth="1.3" opacity="0.75" />
    </g>
  )
}

function smallBlock(x: number, w: number, h: number) {
  const top = GROUND_Y - h
  return (
    <g key={`block-${x}`} opacity={0.85}>
      <rect x={x} y={top} width={w} height={h} fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.2" />
      <line x1={x} y1={top + h * 0.5} x2={x + w} y2={top + h * 0.5} stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />
    </g>
  )
}

// ── The central landmark — tall central structure, large dome, large
// central arch, flanking columns, a stepped/layered roofline, twin smaller
// side towers, and a decorative parapet. The clear focal point: taller,
// more detailed, and now noticeably more luminous than everything around
// it, via a stronger two-layer glow (green core + faint teal bloom).
function centralLandmark() {
  return (
    <g style={{ filter: 'drop-shadow(0 0 8px rgba(63,133,89,0.5)) drop-shadow(0 0 18px rgba(0,184,217,0.22))' }}>
      {/* twin side towers */}
      <rect x="286" y="220" width="18" height="220" fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.6" opacity="0.95" />
      <path d="M 286 220 A 9 22 0 0 1 304 220" fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.4" opacity="0.95" />
      <line x1="295" y1="198" x2="295" y2="180" stroke={ARCH_PRIMARY} strokeWidth="1.9" opacity="0.9" />
      <line x1="286" y1="300" x2="304" y2="300" stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />
      <line x1="286" y1="370" x2="304" y2="370" stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />

      <rect x="396" y="220" width="18" height="220" fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.6" opacity="0.95" />
      <path d="M 396 220 A 9 22 0 0 1 414 220" fill="none" stroke={ARCH_PRIMARY} strokeWidth="2.4" opacity="0.95" />
      <line x1="405" y1="198" x2="405" y2="180" stroke={ARCH_PRIMARY} strokeWidth="1.9" opacity="0.9" />
      <line x1="396" y1="300" x2="414" y2="300" stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />
      <line x1="396" y1="370" x2="414" y2="370" stroke={ARCH_PRIMARY} strokeWidth="1.1" opacity="0.65" />

      {/* main gateway block */}
      <rect x="310" y="150" width="80" height="290" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="3.4" />

      {/* decorative parapet along the top edge */}
      {[316, 328, 340, 352, 364, 376, 384].map((x, i) => (
        <line key={i} x1={x} y1="150" x2={x} y2="141" stroke={ARCH_HIGHLIGHT} strokeWidth="1.8" opacity="0.9" />
      ))}
      {/* cornice lines */}
      <line x1="312" y1="163" x2="388" y2="163" stroke={ARCH_HIGHLIGHT} strokeWidth="1.4" opacity="0.85" />
      <line x1="312" y1="171" x2="388" y2="171" stroke={ARCH_HIGHLIGHT} strokeWidth="1.4" opacity="0.75" />

      {/* flanking columns either side of the great arch */}
      <line x1="317" y1="185" x2="317" y2="440" stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.75" />
      <line x1="325" y1="185" x2="325" y2="440" stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.75" />
      <line x1="375" y1="185" x2="375" y2="440" stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.75" />
      <line x1="383" y1="185" x2="383" y2="440" stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.75" />

      {/* the great central arch opening */}
      <path d="M 332 440 L 332 262 A 18 38 0 0 1 368 262 L 368 440" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="3.2" />
      {/* small decorative arch windows either side of the opening */}
      <path d="M 316 400 A 6 15 0 0 1 328 400" fill="none" stroke={ARCH_PRIMARY} strokeWidth="1.8" opacity="0.85" />
      <path d="M 372 400 A 6 15 0 0 1 384 400" fill="none" stroke={ARCH_PRIMARY} strokeWidth="1.8" opacity="0.85" />
      <path d="M 316 220 A 6 26 0 0 1 328 220" fill="none" stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.7" />
      <path d="M 372 220 A 6 26 0 0 1 384 220" fill="none" stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.7" />

      {/* stepped upper tier — a second, layered architectural section */}
      <rect x="330" y="120" width="40" height="30" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="2.8" />
      <line x1="333" y1="128" x2="367" y2="128" stroke={ARCH_HIGHLIGHT} strokeWidth="1.3" opacity="0.85" />

      {/* crowning dome */}
      <path d="M 326 120 A 24 58 0 0 1 374 120" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="3.6" />
      <line x1="350" y1="62" x2="350" y2="36" stroke={ARCH_HIGHLIGHT} strokeWidth="2.8" />
      <circle cx="350" cy="30" r="3.2" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="2.4" />
    </g>
  )
}

function CitySkylineIllustration() {
  return (
    <svg viewBox="0 0 700 480" className="city-skyline-svg" aria-hidden="true">
      {/* ── Background: distant, faint skyline strip ───────────────────── */}
      <g opacity="0.35">
        {BG_BUILDINGS.map((b, i) => (
          <rect key={i} x={b.x} y={GROUND_Y - b.h} width={b.w} height={b.h} fill="none" stroke={ARCH_DISTANT} strokeWidth="1.4" />
        ))}
      </g>

      {/* ── Midground: ordinary buildings, a couple with a simple dome ──── */}
      <g opacity="0.65">
        {MIDGROUND.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={GROUND_Y - b.h} width={b.w} height={b.h} fill="none" stroke={ARCH_PRIMARY} strokeWidth="2" />
            <line x1={b.x} y1={GROUND_Y - b.h * 0.6} x2={b.x + b.w} y2={GROUND_Y - b.h * 0.6} stroke={ARCH_PRIMARY} strokeWidth="1" opacity="0.7" />
            <line x1={b.x} y1={GROUND_Y - b.h * 0.3} x2={b.x + b.w} y2={GROUND_Y - b.h * 0.3} stroke={ARCH_PRIMARY} strokeWidth="1" opacity="0.7" />
            {b.dome && (
              <path
                d={`M ${b.x} ${GROUND_Y - b.h} A ${b.w / 2} ${b.w / 2} 0 0 1 ${b.x + b.w} ${GROUND_Y - b.h}`}
                fill="none" stroke={ARCH_PRIMARY} strokeWidth="2"
              />
            )}
          </g>
        ))}
      </g>

      {/* ── Ground line + subtle data-grid ticks ────────────────────────── */}
      <line x1="6" y1={GROUND_Y} x2="694" y2={GROUND_Y} stroke={ARCH_PRIMARY} strokeWidth="1.6" opacity="0.55" />
      <g opacity="0.25">
        {GRID_TICKS.map((x, i) => (
          <line key={i} x1={x} y1={GROUND_Y} x2={x} y2={GROUND_Y + 6} stroke={ARCH_HIGHLIGHT} strokeWidth="1.4" />
        ))}
      </g>

      {/* ── Foreground — left half, tapering toward the edge ─────────────── */}
      {windowGridTower(20, 62, 220, { pulse: 'a' })}
      {spireTower(96, 30, 260)}
      {domedBuilding(140, 58, 200)}
      {archedMidrise(212, 52, 160)}
      {smallBlock(272, 26, 100)}

      {/* ── Central landmark — the focal point ───────────────────────────── */}
      {centralLandmark()}

      {/* ── Foreground — right half (mirrors the left cluster) ───────────── */}
      {smallBlock(402, 26, 100)}
      {archedMidrise(436, 52, 160)}
      {domedBuilding(502, 58, 200)}
      {spireTower(574, 30, 260)}
      {windowGridTower(618, 62, 220, { pulse: 'b' })}

      {/* ── Smart-city infrastructure: a faint connecting line between the
          two tower antennae, arcing over the landmark, plus a scatter of
          tiny "sensor node" dots — subtle enough to read as connectivity,
          not a circuit-board pattern. ─────────────────────────────────── */}
      <path d="M 51 124 Q 350 26 649 124" fill="none" stroke={ARCH_HIGHLIGHT} strokeWidth="1.3" strokeDasharray="2 5" opacity="0.4" />
      {NODE_DOTS.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2" fill="rgba(63,133,89,0.6)" />
      ))}
    </svg>
  )
}

// Branding panel carrying an original smart-city skyline illustration and
// the "Smart Cities. Safer Tomorrow." tagline. Purely decorative
// (aria-hidden illustration, no interactive elements), so it never competes
// with real controls for focus order or screen-reader attention.
//
// `compact` drops the card chrome (background/border/shadow) and shrinks
// the type — for the sidebar placement, where the dark-green sidebar
// itself already supplies the panel background, a second bordered card
// nested inside it would just look like a box within a box.
export default function CitySkylinePanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'city-skyline-panel city-skyline-panel-compact' : 'city-skyline-panel'} aria-hidden="true">
      <div className="city-skyline-glow" />
      <CitySkylineIllustration />
      <div className="city-skyline-tagline">
        <span className="city-skyline-tagline-primary">Smart Cities.</span>
        <span className="city-skyline-tagline-secondary">Safer Tomorrow.</span>
      </div>
    </div>
  )
}
