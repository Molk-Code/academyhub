/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // "Ember" palette — ember orange on cool blue-grey surfaces.
      colors: {
        brand: {
          50:  '#fff1ec',
          100: '#ffdbd0',
          200: '#ffb59d',
          300: '#ffa07f',
          400: '#ff8a5c',
          500: '#ff6b35',
          600: '#f25c24',
          700: '#d14812',
          800: '#ab3500',
          900: '#5d1900',
          dim: '#390c00',
        },
        // Neutral surfaces + text. Overrides Tailwind's zinc/slate so every
        // existing bg-zinc-900 / text-zinc-400 etc. picks up the palette.
        zinc: {
          50:  '#f6f7f9',
          100: '#eef0f5',
          200: '#dfe2eb',
          300: '#c8ccd5',
          400: '#a9aeb8',
          500: '#8b909b',
          600: '#5d626c',
          700: '#31353c',
          800: '#262a31',
          900: '#1c2026',
          950: '#0a0e14',
        },
        slate: {
          50:  '#f6f7f9',
          100: '#eef0f5',
          200: '#dfe2eb',
          300: '#c8ccd5',
          400: '#a9aeb8',
          500: '#8b909b',
          600: '#5d626c',
          700: '#31353c',
          800: '#1c2026',
          900: '#181c22',
          950: '#0a0e14',
        },
        navy: {
          300: '#b4c5ff',
          400: '#8fa8f5',
          500: '#0053db',
          600: '#003ea8',
          700: '#31353c',
          800: '#1c2026',
          900: '#10141a',
        },
        surface: {
          primary: '#10141a',
          DEFAULT:  '#1c2026',
          elevated: '#262a31',
          hover:    '#31353c',
        },
        ember: {
          secondary: '#b4c5ff',
          tertiary:  '#4edea3',
          muted:     '#e1bfb5',
        },
        gold: {
          300: '#fcd06a',
          400: '#f6ae2d',
          500: '#e09a1a',
          600: '#c47e0a',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-once': 'bounce 0.6s ease-in-out 1',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.5)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.6)',
        ember: '0 0 16px -2px rgba(255,107,53,0.55)',
        'ember-sm': '0 0 12px rgba(255,107,53,0.4)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
