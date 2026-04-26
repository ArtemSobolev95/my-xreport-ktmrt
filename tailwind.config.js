/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./app/**/*.{js,ts,jsx,tsx}",        // на всякий случай
    "./src/**/*.{js,ts,jsx,tsx}",        // если у тебя есть папка src
  ],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: ["dark"],     // твоя тёмная тема
    darkTheme: "dark",
  },
}
