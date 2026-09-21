import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import '../landing.css'
import { useAuth } from '../lib/auth'
import { isAutoEnterSuppressed } from '../lib/landingNavGuard'
import LandingHero from '../components/landing/LandingHero'
import ProblemGrid from '../components/landing/ProblemGrid'
import PipelineDiagram from '../components/landing/PipelineDiagram'
import TrajectoryVisualization from '../components/landing/TrajectoryVisualization'

export default function Landing() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  // Set by Layout.tsx's logo link — a signed-in visitor who deliberately
  // asked to see the landing page again shouldn't get auto-bounced back to
  // the dashboard the moment they scroll, unlike a fresh sign-in landing here.
  const revisiting = Boolean((location.state as { skipAutoEnter?: boolean } | null)?.skipAutoEnter)

  // Scrolling down past the hero jumps a signed-in visitor straight to the
  // dashboard — no button needed. Everyone else just keeps scrolling into
  // the rest of the landing page (sign-in now happens right in the hero's
  // own panel, so there's no separate destination to bounce logged-out
  // visitors to). Only fires on active downward scrolling, and only once,
  // so clicking a nav link (which suppresses this — see landingNavGuard)
  // or scrolling back up never triggers it.
  useEffect(() => {
    if (!user || revisiting) return
    let triggered = false
    let lastY = window.scrollY
    let ticking = false

    const check = () => {
      ticking = false
      const y = window.scrollY
      const scrollingDown = y > lastY
      lastY = y
      if (triggered || !scrollingDown || isAutoEnterSuppressed()) return
      if (y > window.innerHeight * 0.96) {
        triggered = true
        navigate('/dashboard')
      }
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(check)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [navigate, user, revisiting])

  // A deliberate upward swipe jumps straight to the dashboard, same intent
  // as the scroll-past-hero listener above but independent of scroll
  // position — works as an explicit gesture shortcut from anywhere on the
  // page, not just at the top, and doesn't depend on scroll-event mechanics
  // (which can behave inconsistently with touch momentum scrolling).
  //
  // Two input paths, because "swipe up" means different DOM events depending
  // on the device: a real touchscreen fires touchstart/touchend, but a
  // laptop trackpad's two-finger swipe fires wheel events instead — it
  // never generates TouchEvents at all. Both are handled here so the
  // gesture works when testing on a laptop, not only on an actual phone.
  useEffect(() => {
    if (!user || revisiting) return
    let triggered = false

    const fire = () => {
      if (triggered || isAutoEnterSuppressed()) return
      triggered = true
      navigate('/dashboard')
    }

    // Touch path (phones/tablets)
    let startX = 0
    let startY = 0
    const SWIPE_THRESHOLD_PX = 60

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const deltaY = startY - t.clientY
      const deltaX = Math.abs(t.clientX - startX)
      // Mostly-vertical, upward, past the threshold — rejects diagonal
      // drags and small accidental touches.
      if (deltaY > SWIPE_THRESHOLD_PX && deltaY > deltaX * 1.5) fire()
    }

    // Trackpad path (laptops) — a deliberate swipe is a fast burst of wheel
    // events with a large cumulative deltaY, unlike slow, steady scrolling.
    // deltaY > 0 is "natural scrolling" swipe-up (macOS default).
    let burstSum = 0
    let burstStart = 0
    const WHEEL_BURST_THRESHOLD = 80
    const WHEEL_BURST_MAX_MS = 400
    const WHEEL_GAP_RESET_MS = 200

    const onWheel = (e: WheelEvent) => {
      const now = performance.now()
      if (now - burstStart > WHEEL_GAP_RESET_MS) {
        burstSum = 0
        burstStart = now
      }
      burstSum += e.deltaY
      if (burstSum > WHEEL_BURST_THRESHOLD && now - burstStart < WHEEL_BURST_MAX_MS) fire()
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('wheel', onWheel)
    }
  }, [navigate, user, revisiting])

  return (
    <div className="landing">
      <LandingHero />
      <ProblemGrid />
      <PipelineDiagram />
      <TrajectoryVisualization />
    </div>
  )
}
