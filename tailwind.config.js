/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fff3ec',
          100: '#fde0c8',
          200: '#fbb98a',
          300: '#f88e4c',
          400: '#f47230',
          500: '#f26419',
          600: '#d44e0a',
          700: '#aa3c07',
          800: '#7e2d06',
          900: '#5c2005',
          dim: '#3d1503',
        },
        navy: {
          300: '#86bbd8',
          400: '#5a93b4',
          500: '#33658a',
          600: '#285070',
          700: '#2f4858',
          800: '#1e3347',
          900: '#0d1b24',
        },
        surface: {
          primary: '#0d1b24',
          DEFAULT:  '#1a2d3d',
          elevated: '#243648',
          hover:    '#2f4858',
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
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-once': 'bounce 0.6s ease-in-out 1',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.5)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
