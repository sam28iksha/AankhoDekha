import { Github } from 'lucide-react'
import { suppressAutoEnter } from '../../lib/landingNavGuard'

export default function LandingNav() {
  return (
    <nav
      className="flex-shrink-0 flex items-center justify-between px-6 md:px-10 h-16"
      style={{ background: 'var(--landing-ink)' }}
    >
      <div className="flex items-center gap-2">
        <span className="brand-wordmark text-base leading-none">
          <span className="brand-wordmark-cap">A</span>ankho<span className="brand-wordmark-cap">D</span>ekhà
        </span>
      </div>

      <div className="hidden md:flex items-center gap-3">
        <div className="text-[12px] tracking-wide text-white/70 border border-white/30 px-3 py-1.5">
          Username — <span className="font-mono text-white/90">admin</span>
        </div>
        <div className="text-[12px] tracking-wide text-white/70 border border-white/30 px-3 py-1.5">
          Password — <span className="font-mono text-white/90">aankhodekha_admin</span>
        </div>
        {/* TODO: swap href for the real repo URL once provided */}
        <a
          href="#"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[12px] tracking-wide text-white/70 hover:text-white transition-colors border border-white/30 px-3 py-1.5"
        >
          <Github size={13} />
          GitHub
        </a>
      </div>

      <a
        href="#signin"
        onClick={() => suppressAutoEnter()}
        className="text-[12px] tracking-wide text-white hover:opacity-80 transition-opacity border border-white/30 px-3 py-1.5"
      >
        Sign in
      </a>
    </nav>
  )
}
