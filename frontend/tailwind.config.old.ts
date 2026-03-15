import type { Config } from "tailwindcss"

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#F8F9FA",
        border: "#E5E7EB",
        status: {
          idle: "#10B981",
          busy: "#F59E0B",
          error: "#EF4444",
        },
        agent: {
          build: "#3B82F6",
          general: "#8B5CF6",
          explore: "#6B7280",
          plan: "#06B6D4",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config
