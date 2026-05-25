/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces — drive via CSS vars pra suportar tema claro/escuro.
        // Sintaxe `rgb(var(--x) / <alpha-value>)` permite usar com /opacity:
        //   bg-bg/80, text-foreground/55, etc.
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        card: 'rgb(var(--card-rgb) / <alpha-value>)',
        sidebar: 'rgb(var(--sidebar-rgb) / <alpha-value>)',

        // Texto principal — substitui o uso de `text-white`.
        foreground: 'rgb(var(--foreground-rgb) / <alpha-value>)',

        // Overlay/elevation — substitui o uso de `bg-white/[X]` e
        // `border-white/X`. Branco no dark, preto no light.
        elevate: 'rgb(var(--elevate-rgb) / <alpha-value>)',

        // Bordas (cor completa com alpha embutido)
        line: 'var(--line)',
        lineSoft: 'var(--line-soft)',

        // Cores semânticas — mesmas em ambos os temas
        accent: {
          DEFAULT: '#4F8EF7',
          hover: '#6BA0F9',
          dim: 'rgba(79,142,247,0.15)',
        },
        success: '#34D399',
        danger: '#F87171',
        warning: '#FBBF24',
        muted: '#9CA3AF',
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
