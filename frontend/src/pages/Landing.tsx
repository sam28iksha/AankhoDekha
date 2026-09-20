import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import '../landing.css'
import { useAuth } from '../lib/auth'
import { isAutoEnterSuppressed } from '../lib/landingNavGuard'
import LandingHero from '../components/landing/LandingHero'
import ProblemGrid from '../components/landing/ProblemGrid'
import PipelineDiagram from '../components/landing/PipelineDiagram'
import TrajectoryVisualization from '../components/landing/TrajectoryVisualization'

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Scrolling down past the hero jumps a signed-in visitor straight to the
  // dashboard — no button needed. Everyone else just keeps scrolling into
  // the rest of the landing page (sign-in now happens right in the hero's
  // own panel, so there's no separate destination to bounce logged-out
  // visitors to). Only fires on active downward scrolling, and only once,
  // so clicking a nav link (which suppresses this — see landingNavGuard)
  // or scrolling back up never triggers it.
  useEffect(() => {
    if (!user) return
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
  }, [navigate, user])

  return (
    <div className="landing">
      <LandingHero />
      <ProblemGrid />
      <PipelineDiagram />
      <TrajectoryVisualization />
    </div>
  )
}
