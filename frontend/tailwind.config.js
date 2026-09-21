/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Global type-scale bump (~10-20%, per size) — deliberately only
      // `fontSize`, never `spacing`: Tailwind's padding/margin/gap/width
      // utilities are a separate rem scale, so this raises text size
      // consistently across every page without moving anything or
      // resizing any card/container. text-sm lands at exactly 16px (the
      // "minimum base size for normal UI text" target) and text-2xl at
      // 28px (top-of-range for KPI-style numbers) without per-component
      // overrides.
      fontSize: {
        xs: ['0.85rem', { lineHeight: '1.15rem' }],
        sm: ['1rem', { lineHeight: '1.4rem' }],
        base: ['1.125rem', { lineHeight: '1.7rem' }],
        lg: ['1.25rem', { lineHeight: '1.85rem' }],
        xl: ['1.4rem', { lineHeight: '2rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.2rem' }],
      },
      colors: {
        // AANKHODEKHA brand palette
        brand: {
          50: "#f0f7ff",
          100: "#e0effe",
          200: "#b9dffd",
          300: "#7cc5fb",
          400: "#36a7f7",
          500: "#0d8fe8",
          600: "#016ec5",
          700: "#0158a0",
          800: "#064b84",
          900: "#0b406e",
          950: "#07284a",
        },
        accent: {
          orange: "#f97316",
          red: "#ef4444",
          green: "#22c55e",
          amber: "#f59e0b",
        },
        surface: {
          900: "#0a0f1e",
          800: "#0f172a",
          700: "#1e293b",
          600: "#334155",
          500: "#475569",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-brand': 'linear-gradient(135deg, #0d8fe8 0%, #0158a0 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
