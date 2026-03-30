/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0B0F14",
        surface: "#121821",
        elevated: "#1A2330",
        primary: "#3BA4FF",
        accent: "#5CE1E6",
        success: "#22C55E",
        warning: "#F59E0B",
        error: "#EF4444",
      },
      textColor: {
        primary: "#E6EDF3",
        secondary: "#9AA6B2",
        muted: "#6B7785",
      },
      borderColor: {
        DEFAULT: "#2A3441",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
