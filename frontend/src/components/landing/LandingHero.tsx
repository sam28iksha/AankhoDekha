import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pause, Play, ChevronDown } from 'lucide-react'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { useAuth } from '../../lib/auth'
import LandingNav from './LandingNav'
import LandingLoginPanel from './LandingLoginPanel'

// A touch slower than real-time reads calmer for a looping background —
// kept modest so motion still looks natural, not like a slow-mo effect.
const HERO_PLAYBACK_RATE = 0.75

export default function LandingHero() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const [playing, setPlaying] = useState(!prefersReducedMotion)
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = HERO_PLAYBACK_RATE
  }, [])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  // For a signed-in visitor this is a shortcut to the dashboard (same as
  // scrolling past the hero — see Landing.tsx). For everyone else, the
  // sign-in panel is already right here in the hero, so this just scrolls
  // down to it instead of navigating anywhere.
  const enterPlatform = () => {
    if (user) {
      navigate('/dashboard')
    } else {
      document.getElementById('signin')?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' })
    }
  }

  return (
    <section className="relative w-full h-screen overflow-hidden flex flex-col">
      {/* Video + overlaid copy — everything here is positioned relative to
          this wrapper, not the full section, so the nav bar below stays on
          its own solid ground rather than translucently over the footage. */}
      <div className="relative flex-1 overflow-hidden">
        {/* No CSS filter on the video itself — filters on <video> force
            per-frame software compositing and can disable hardware-
            accelerated decode, which caused visible stutter before.
            The dimming is done via the scrim layers below instead. */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          src="/hero.mp4"
          poster="/hero-poster.jpg"
          autoPlay={!prefersReducedMotion}
          muted
          loop
          playsInline
        />
        <div className="absolute inset-0" style={{ background: 'rgba(10, 12, 10, 0.16)' }} />
        {/* Scrim for text legibility, heavier toward the bottom where copy sits */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(15,15,13,0.05) 0%, rgba(15,15,13,0.16) 45%, rgba(15,15,13,0.6) 100%)' }}
        />

        <button
          onClick={togglePlayback}
          aria-label={playing ? 'Pause background video' : 'Play background video'}
          className="absolute top-6 right-6 md:top-8 md:right-10 z-20 w-10 h-10 flex items-center justify-center border border-white/30 bg-black/20 text-white hover:bg-white/10 transition-colors"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>

        {/* Just the eye graphic from the logo — background removed, no
            square card behind it — as a small mark in the corner. */}
        <img
          src="/eye-icon.png"
          alt=""
          className="absolute top-6 left-6 md:top-8 md:left-10 z-20 w-24 sm:w-32 md:w-40 h-auto"
          style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))' }}
        />

        {/* Name + one-line pitch, anchored to the bottom-left corner.
            Static — no entrance or idle motion. */}
        <div className="absolute bottom-16 md:bottom-20 left-6 md:left-10 z-10 max-w-[90vw] md:max-w-[560px]">
          <h1 className="inline-block">
            <span className="brand-wordmark text-[9vw] sm:text-6xl md:text-7xl leading-none whitespace-nowrap">
              <span className="brand-wordmark-cap">A</span>ankho<span className="brand-wordmark-cap">D</span>ekhà
            </span>
          </h1>
          <div
            className="mt-1.5 text-white/80 text-[18px] font-bold"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
          >
            The Eye of the City
          </div>
          <p
            className="mt-4 text-white/85 text-[13px] max-w-[46ch]"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
          >
            Real-time license-plate recognition and traffic intelligence, watching over the whole city at once.
          </p>
        </div>

        {/* Sign-in panel — the only way in now that there's no separate
            /login route, so it has to work on every screen size. A single
            instance (not one per breakpoint — that duplicated element IDs)
            repositioned via responsive classes: centered near the top on
            mobile so it doesn't collide with the bottom-anchored headline,
            floating on the right vertically centered on desktop. */}
        <div
          id="signin"
          className="flex absolute z-20 inset-x-4 top-24 justify-center md:inset-x-auto md:top-1/2 md:right-6 lg:right-10 md:justify-start md:-translate-y-1/2"
        >
          <LandingLoginPanel />
        </div>

        <button
          onClick={enterPlatform}
          aria-label="Enter the platform"
          className={`absolute bottom-6 right-6 md:right-10 z-20 text-white/80 hover:text-white transition-colors ${prefersReducedMotion ? '' : 'animate-bounce'}`}
        >
          <ChevronDown size={22} />
        </button>
      </div>

      <LandingNav />
    </section>
  )
}
