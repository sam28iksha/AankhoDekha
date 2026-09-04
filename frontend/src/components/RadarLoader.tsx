interface RadarLoaderProps {
  size?: number
  className?: string
}

/**
 * Branded loading indicator — a rotating radar sweep with a pulsing center
 * dot, fitting "The Eye of the City" scanning motif. Drop-in replacement for
 * a generic spinner icon; purely visual, carries no state of its own.
 */
export default function RadarLoader({ size = 20, className = '' }: RadarLoaderProps) {
  return (
    <div
      className={`radar-loader ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    >
      <div className="radar-dot" />
    </div>
  )
}
