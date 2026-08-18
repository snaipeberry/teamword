/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        clue: {
          DEFAULT: '#FFFFFF',
          accent: '#FFE1B8',
        },
        cell: {
          DEFAULT: '#FFFFFF',
          active: '#4DE8EF',
          border: '#F0B94A',
        },
        aurora: {
          violet: '#5B2A86',
          magenta: '#C0388A',
          coral: '#FF7A59',
          amber: '#FFB347',
        },
      },
      fontFamily: {
        display: ['Fredoka', 'sans-serif'],
        grid: ['Fredoka', 'sans-serif'],
        clue: ['Nunito', 'sans-serif'],
      },
      keyframes: {
        'blob-float-a': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(6%, 8%) scale(1.08)' },
          '66%': { transform: 'translate(-4%, 4%) scale(0.96)' },
        },
        'blob-float-b': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '40%': { transform: 'translate(-8%, -5%) scale(1.1)' },
          '70%': { transform: 'translate(5%, -7%) scale(0.94)' },
        },
        'blob-float-c': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(4%, -9%) scale(1.06)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'blob-float-a': 'blob-float-a 22s ease-in-out infinite',
        'blob-float-b': 'blob-float-b 26s ease-in-out infinite',
        'blob-float-c': 'blob-float-c 19s ease-in-out infinite',
        'pop-in': 'pop-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
