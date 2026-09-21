import { useScrollReveal } from '../../lib/useScrollReveal'

const STEPS = [
  {
    index: '01',
    title: 'Detection',
    body: 'A YOLOv8 model scans each sampled frame for license plates and returns bounding boxes.',
    module: 'backend/anpr/detector.py',
  },
  {
    index: '02',
    title: 'OCR',
    body: 'Each detected plate crop is read with PaddleOCR, then validated and corrected against real Indian plate-format rules.',
    module: 'backend/anpr/ocr.py',
  },
  {
    index: '03',
    title: 'Temporal clustering',
    body: 'The same plate is usually read several times as a vehicle crosses the frame. Readings are clustered and reconciled by similarity and OCR confidence into one event.',
    module: 'backend/anpr/pipeline.py',
  },
  {
    index: '04',
    title: 'Cross-camera matching',
    body: 'A vehicle’s route is reconstructed by matching its normalized plate text across cameras and time — not by visual re-identification.',
    module: 'backend/api/vehicle.py',
  },
]

function Step({
  index,
  title,
  body,
  module,
  delay,
  isLast,
}: {
  index: string
  title: string
  body: string
  module: string
  delay: number
  isLast: boolean
}) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`landing-reveal ${visible ? 'landing-reveal-visible' : ''} relative flex-1 pr-6`}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      {!isLast && (
        <div
          className="hidden md:block absolute top-3 left-0 w-full h-px"
          style={{ background: 'var(--landing-border)' }}
        />
      )}
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold mb-5 relative z-10"
        style={{ background: 'var(--landing-bg)', border: '1px solid var(--landing-ink)', color: 'var(--landing-ink)' }}
      >
        {index}
      </div>
      <h3 className="text-lg mb-2">{title}</h3>
      <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--landing-ink-soft)' }}>
        {body}
      </p>
      <code
        className="text-[11px] px-2 py-1 inline-block"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--landing-ink-soft)',
          background: 'var(--landing-surface)',
        }}
      >
        {module}
      </code>
    </div>
  )
}

export default function PipelineDiagram() {
  const { ref: headerRef, visible: headerVisible } = useScrollReveal<HTMLDivElement>()

  return (
    <section id="pipeline" className="px-6 md:px-10 py-24 md:py-32" style={{ background: 'var(--landing-surface)' }}>
      <div className="max-w-6xl mx-auto">
        <div
          ref={headerRef}
          className={`landing-reveal ${headerVisible ? 'landing-reveal-visible' : ''} max-w-2xl mb-16 md:mb-20`}
        >
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--landing-ink-faint)' }}>
            PIPELINE
          </div>
          <h2 className="text-3xl md:text-4xl mb-4">How a plate becomes a route</h2>
          <p className="text-base" style={{ color: 'var(--landing-ink-soft)' }}>
            Four real, running stages — each one is an actual module in the codebase,
            not a conceptual diagram.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-10 md:gap-0">
          {STEPS.map((step, i) => (
            <Step key={step.index} {...step} delay={i * 100} isLast={i === STEPS.length - 1} />
          ))}
        </div>
      </div>
    </section>
  )
}
