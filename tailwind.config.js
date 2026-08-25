/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Grille : cases claires sur fond crème, plus de contraste cyan/ambre.
        clue: {
          DEFAULT: '#EBDDC5',
          accent: '#FFE1D0',
        },
        cell: {
          DEFAULT: '#FFFFFF',
          active: '#FFFFFF',
          border: '#DCD3C4',
        },
        // Organic — miroir de ds/organic.css (maquette Claude Design
        // d9d2c198-ef37-47f9-b49d-9fef1d81f767). Rampes générées en OKLCH sur
        // une même échelle de luminosité : le même palier de accent/accent2/
        // neutral a la même valeur visuelle d'une rampe à l'autre.
        organic: {
          bg: '#f5ead8',
          surface: '#ebddc5',
          text: '#201e1d',
          divider: 'rgba(32,30,29,0.16)',
          neutral: {
            100: '#f9f4ed',
            200: '#eee7db',
            300: '#dcd3c4',
            400: '#c0b6a5',
            500: '#a19786',
            600: '#82796a',
            700: '#645c50',
            800: '#474238',
            900: '#2e2b25',
          },
          accent: {
            100: '#fff2eb',
            200: '#ffe1d0',
            300: '#ffc6a5',
            400: '#f6a06b',
            500: '#d67f48',
            600: '#b2622d',
            700: '#8c491a',
            800: '#643312',
            900: '#402310',
          },
          accent2: {
            100: '#f0fae1',
            200: '#e1eecc',
            300: '#ccdbb2',
            400: '#aebf92',
            500: '#8fa073',
            600: '#728157',
            700: '#56633f',
            800: '#3d472b',
            900: '#272e1b',
          },
        },
      },
      fontFamily: {
        display: ['Caprasimo', 'system-ui', 'sans-serif'],
        grid: ['Figtree', 'system-ui', 'sans-serif'],
        clue: ['Figtree', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'pop-in': 'pop-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
