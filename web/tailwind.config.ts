import type { Config } from 'tailwindcss';

// Tailwind v3 (проверенный паттерн с Next 15). darkMode 'class' — для next-themes
// (атрибут class на <html>). accent — нейтральная zinc-палитра + indigo/violet акцент.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './data/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#6366f1', // indigo-500
          soft: '#8b5cf6', // violet-500
        },
      },
    },
  },
  plugins: [],
};

export default config;
