// Original wing+eye brand mark — an eye (watching the city) with a wing
// feathering off its left side (swift, in-motion tracking), drawn as a
// simple stroke icon so it sits naturally alongside the lucide-react icons
// used everywhere else in the app.
export default function Logomark({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 9 Q3 6.5 0.5 7.5" />
      <path d="M8 11.2 Q2.3 10.6 0.3 11.5" />
      <path d="M8 13.4 Q3.2 15 1 16" />
      <path d="M9 12 C12 6 20 6 23 12 C20 18 12 18 9 12 Z" />
      <circle cx="16" cy="12" r="3" />
    </svg>
  )
}
