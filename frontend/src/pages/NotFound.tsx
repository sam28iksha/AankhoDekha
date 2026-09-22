import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Home,
  Radar,
  Search,
} from 'lucide-react'

export default function NotFound() {
  useEffect(() => {
    document.title = '404 — Route Not Found | NagarNetra'

    return () => {
      document.title = 'NagarNetra'
    }
  }, [])

  return (
    <div
      className="min-h-screen flex items-center justify-center overflow-hidden relative"
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      {/* ================================================================
          BACKGROUND GRID
          ================================================================ */}

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(
              rgba(0, 200, 160, 0.035) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              rgba(0, 200, 160, 0.035) 1px,
              transparent 1px
            )
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(circle at center, black 0%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(circle at center, black 0%, transparent 75%)',
        }}
      />

      {/* ================================================================
          RADAR GLOW
          ================================================================ */}

      <div
        className="absolute pointer-events-none"
        style={{
          width: 520,
          height: 520,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(0, 200, 160, 0.08) 0%, transparent 68%)',
        }}
      />

      {/* ================================================================
          RADAR RINGS
          ================================================================ */}

      <div
        className="absolute pointer-events-none flex items-center justify-center"
        style={{
          width: 420,
          height: 420,
          border:
            '1px solid rgba(0, 200, 160, 0.10)',
          borderRadius: '50%',
        }}
      >
        <div
          style={{
            width: 280,
            height: 280,
            border:
              '1px solid rgba(0, 200, 160, 0.08)',
            borderRadius: '50%',
          }}
        >
          <div
            style={{
              width: 140,
              height: 140,
              border:
                '1px solid rgba(0, 200, 160, 0.08)',
              borderRadius: '50%',
              margin: '69px auto',
            }}
          />
        </div>
      </div>

      {/* ================================================================
          MAIN CONTENT
          ================================================================ */}

      <main
        className="relative z-10 flex flex-col items-center text-center px-6"
        style={{
          maxWidth: 680,
        }}
      >

        {/* RADAR ICON */}

        <div
          className="flex items-center justify-center mb-7"
          style={{
            width: 72,
            height: 72,
            borderRadius: '18px',
            background:
              'rgba(0, 200, 160, 0.07)',
            border:
              '1px solid rgba(0, 200, 160, 0.20)',
            boxShadow:
              '0 0 40px rgba(0, 200, 160, 0.08)',
          }}
        >
          <Radar
            size={34}
            style={{
              color:
                'var(--accent-green)',
            }}
          />
        </div>


        {/* SYSTEM LABEL */}

        <div
          className="page-kicker mb-3"
          style={{
            color:
              'var(--accent-green)',
          }}
        >
          NAGARNETRA COMMAND CENTER
        </div>


        {/* 404 */}

        <h1
          style={{
            fontSize:
              'clamp(96px, 15vw, 170px)',
            lineHeight: 0.85,
            fontWeight: 800,
            letterSpacing: '-0.07em',
            margin: 0,
            background:
              'linear-gradient(180deg, var(--text-primary), rgba(255,255,255,0.28))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:
              'transparent',
          }}
        >
          404
        </h1>


        {/* TITLE */}

        <h2
          className="mt-8"
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          Route Not Found
        </h2>


        {/* DESCRIPTION */}

        <p
          className="mt-3"
          style={{
            maxWidth: 480,
            fontSize: 14,
            lineHeight: 1.7,
            color:
              'var(--text-muted)',
          }}
        >
          The requested route could not be located
          in the NagarNetra command center.
          The system is operational, but this
          destination does not exist.
        </p>


        {/* STATUS */}

        <div
          className="flex items-center gap-2 mt-6 px-3 py-2 rounded-full"
          style={{
            background:
              'rgba(0, 200, 120, 0.06)',
            border:
              '1px solid rgba(0, 200, 120, 0.16)',
            fontSize: 11,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, monospace',
            color:
              'var(--text-muted)',
          }}
        >

          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background:
                'var(--accent-green)',
              boxShadow:
                '0 0 8px rgba(0, 220, 130, 0.65)',
            }}
          />

          SYSTEM OPERATIONAL

        </div>


        {/* ACTIONS */}

        <div className="flex items-center gap-3 mt-8 flex-wrap justify-center">

          <Link
            to="/"
            className="btn-primary flex items-center gap-2"
            style={{
              textDecoration: 'none',
            }}
          >
            <Home size={14} />
            Command Center
          </Link>


          <Link
            to="/vehicle-search"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              color:
                'var(--text-primary)',
              background:
                'var(--bg-card)',
              border:
                '1px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            <Search size={14} />
            Vehicle Search
          </Link>

        </div>


        {/* BACK */}

        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 mt-6 text-xs"
          style={{
            color:
              'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={12} />
          Go back
        </button>


        {/* FOOTER */}

        <div
          className="mt-12 text-[10px]"
          style={{
            color:
              'var(--text-muted)',
            opacity: 0.55,
            letterSpacing:
              '0.08em',
          }}
        >
          THE EYE OF THE CITY
        </div>

      </main>
    </div>
  )
}