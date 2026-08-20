/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Refined dark theme -- deep, cool void with a warm-gold/deep-indigo signature accent
        // pair ("solar horizon"), replacing the earlier flat blue-dashboard look. Status colors
        // keep their MEANING (red=pending, orange=issue, green=replaced, grey=normal) -- only
        // their values were refined for a more considered, less "bootstrap default" feel.
        bg: {
          DEFAULT: '#07080d',
          panel: '#12141d',
          raised: '#1b1e2a',
        },
        border: {
          DEFAULT: '#242838',
        },
        accent: {
          blue: '#5B6EF5', // primary action color -- refined indigo-violet, not generic SaaS blue
          teal: '#14B8A6',
          amber: '#F5A623', // signature "solar/energy" accent -- used sparingly (horizon line, highlights)
        },
        status: {
          normal: '#7C8AA5',
          reported: '#F0975A',
          pending: '#EF6461',
          replaced: '#4ADE94',
          observation: '#FBC343',
          selected: '#5B6EF5',
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
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
