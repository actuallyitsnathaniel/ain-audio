/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "pulse-strong": {
          "0%, 100%": { opacity: 0 },
          "50%": { opacity: 1 },
        },
      },
      animation: {
        "pulse-strong": "pulse-strong 1s ease-in-out infinite",
      },
    },
  },
  plugins: ["prettier-plugin-tailwindcss"],
};
