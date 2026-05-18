/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0B',
        surface: '#111114',
        card: '#1A1A1F',
        sidebar: '#0D0D10',
        accent: {
          DEFAULT: '#4F8EF7',
          hover: '#6BA0F9',
          dim: 'rgba(79,142,247,0.15)',
        },
        success: '#34D399',
        danger: '#F87171',
        warning: '#FBBF24',
        muted: '#9CA3AF',
        line: 'rgba(255,255,255,0.07)',
        lineSoft: 'rgba(255,255,255,0.05)',
      },
      fontFamily: {
        sans: [
          'Geist',
          'DM Sans',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(79,142,247,0.4), 0 8px 24px -8px rgba(79,142,247,0.35)',
        ringSoft: '0 0 0 4px rgba(79,142,247,0.15)',
        innerGlow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
      },
      animation: {
        shimmer: 'shimmer 1.8s linear infinite',
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-in-right': 'slideInRight 300ms cubic-bezier(0.22,1,0.36,1)',
        'slide-in-left': 'slideInLeft 300ms cubic-bezier(0.22,1,0.36,1)',
        'scale-in': 'scaleIn 180ms ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
