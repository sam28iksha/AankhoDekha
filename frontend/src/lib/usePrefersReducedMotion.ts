import { useEffect, useState } from 'react'

/** Tracks the OS-level "reduce motion" accessibility preference. Most
 * animation logic should prefer gating via the `@media (prefers-reduced-motion)`
 * CSS query directly (see landing.css) so it degrades safely even if a
 * component forgets to check this hook — this is for the handful of cases
 * (video autoplay, JS-driven count-up) that CSS alone can't gate. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
