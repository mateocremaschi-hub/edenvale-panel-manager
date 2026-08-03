/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Same dark professional theme as edenvale-tracker-finder / edenvale-vegetation-control,
        // so the three Edenvale apps feel like one family.
        bg: {
          DEFAULT: '#0b1220', // map / app background (vegetation-control MAP_BG)
          panel: '#0e1621', // card / header background (tracker-finder theme)
          raised: '#141f30',
        },
        border: {
          DEFAULT: '#22304a',
        },
        accent: {
          blue: '#4A90D9',
          teal: '#3FB8AF',
          amber: '#F1C232',
        },
        status: {
          normal: '#5B7290', // neutral grey-blue
          reported: '#E08A3C', // orange
          pending: '#D9534F', // red
          replaced: '#5CB85C', // green
          observation: '#F1C232', // yellow
          selected: '#4A90D9', // blue outline
        },
        row: {
          r1: '#E0745A',
          r2: '#6FA8DC',
          r3: '#93C47D',
          r4: '#D98BA6',
          r5: '#F1C232',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
