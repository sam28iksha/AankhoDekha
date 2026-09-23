import { useScrollReveal } from '../../lib/useScrollReveal'

const PROBLEMS = [
  {
    index: '01',
    title: 'Occlusion',
    body: 'In dense traffic, vehicles block each other’s plates. A partially or fully occluded plate simply produces no usable read for that frame.',
  },
  {
    index: '02',
    title: 'Glare & motion blur',
    body: 'Reflective plates, headlight glare, and vehicle speed relative to a fixed wide-angle camera all degrade OCR confidence, frame to frame.',
  },
  {
    index: '03',
    title: 'Non-overlapping coverage',
    body: 'Cameras sit at spaced-out junctions with dead zones between them — a vehicle can vanish from view for minutes before reappearing elsewhere.',
  },
  {
    index: '04',
    title: 'Matching without shared IDs',
    body: 'There’s no vehicle-borne identifier to link sightings. Each one has to be tied together purely by what was actually read — plate text, camera, and timestamp — which only works when OCR gets the plate right.',
  },
]

function ProblemCard({ index, title, body, delay }: { index: string; title: string; body: string; delay: number }) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`landing-reveal ${visible ? 'landing-reveal-visible' : ''} border-t p-6 md:p-8`}
      style={{ borderColor: 'var(--landing-border)', transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      <div className="text-[12px] font-semibold mb-4" style={{ color: 'var(--landing-accent)', fontFamily: "'Space Grotesk', sans-serif" }}>
        {index}
      </div>
      <h3 className="text-[14px] mb-3">{title}</h3>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--landing-ink-soft)' }}>
        {body}
      </p>
    </div>
  )
}

export default function ProblemGrid() {
  const { ref: headerRef, visible: headerVisible } = useScrollReveal<HTMLDivElement>()

  return (
    <section id="problem" className="px-6 md:px-10 py-24 md:py-32 max-w-6xl mx-auto">
      <div
        ref={headerRef}
        className={`landing-reveal ${headerVisible ? 'landing-reveal-visible' : ''} max-w-2xl mb-14 md:mb-20`}
      >
        <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--landing-ink-faint)' }}>
          THE PROBLEM
        </div>
        <h2 className="text-[18px] mb-4">Why cross-camera tracking is hard</h2>
        <p className="text-[13px]" style={{ color: 'var(--landing-ink-soft)' }}>
          Reading a plate at one camera is the easy part. Reconstructing where a vehicle
          has been across a city-scale network, from imperfect footage and no shared
          coverage, is the actual engineering problem.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 border-b" style={{ borderColor: 'var(--landing-border)' }}>
        {PROBLEMS.map((p, i) => (
          <ProblemCard key={p.index} {...p} delay={i * 80} />
        ))}
      </div>
    </section>
  )
}
