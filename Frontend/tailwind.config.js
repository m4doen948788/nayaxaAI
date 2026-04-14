/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        indigo: {
          50: '#f0f4ff',
          100: '#e1e9ff',
          200: '#c2d1ff',
          300: '#9cb1ff',
          400: '#6f88ff',
          500: '#4f46e5', // Nayaxa Indigo
          600: '#4338ca',
          700: '#3730a3',
          800: '#1e1b4b',
          900: '#0f172a',
        },
        slate: {
          950: '#020617',
        }
      },
      fontFamily: {
        outfit: ['Outfit', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0))',
      },
      boxShadow: {
        'premium': '0 10px 30px -10px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
}
