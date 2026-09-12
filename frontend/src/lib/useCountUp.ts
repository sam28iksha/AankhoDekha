import { useEffect, useRef, useState } from 'react'

// Animates a displayed number from its previous value to a new one whenever
// `value` changes — small, easily-missed dashboard updates (an alert count
// ticking from 2 to 3) read as something that just happened instead of a
// silent DOM swap. Non-numeric or unchanged values pass through untouched.
export function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (value === fromRef.current) return
    const from = fromRef.current
    const delta = value - from
    const start = performance.now()

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // ease-out-cubic — fast start, gentle settle, matches the rest of the
      // UI's transition timing rather than a linear/mechanical count.
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + delta * eased))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [value, durationMs])

  return display
}
