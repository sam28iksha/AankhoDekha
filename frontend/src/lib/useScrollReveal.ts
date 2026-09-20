import { useEffect, useRef, useState } from 'react'

/** Fires once when the element first enters the viewport, then stops
 * observing — reveals never replay on re-entry. The actual fade/slide
 * transition is plain CSS (see .landing-reveal in landing.css), gated
 * primarily by a prefers-reduced-motion media query there; this hook
 * just toggles the class that triggers it. */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.15) {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.unobserve(el)
        }
      },
      { threshold }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return { ref, visible }
}
