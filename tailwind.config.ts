import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "x-blue": "#1d9bf0",
        "x-blue-hover": "#1a8cd8",
        "x-text": "#0f1419",
        "x-sec": "#536471",
        "x-border": "#eff3f4",
        "x-border-dark": "#cfd9de",
        "x-pink": "#f91880",
        "x-green": "#00ba7c",
        "x-hover": "rgba(0,0,0,0.03)",
        "x-pill": "#eff3f4",
        "x-black-btn": "#0f1419",
        "x-black-btn-hover": "#272c30"
      },
      screens: { "xl2": "1265px" },
      fontFamily: {
        chirp: ["var(--font-primary)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"]
      },
      borderRadius: { "2xl": "16px" },
      keyframes: {
        shimmer: { "0%": { opacity: "1" }, "50%": { opacity: "0.4" }, "100%": { opacity: "1" } },
        toastup: { "0%": { transform: "translateY(16px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } }
      },
      animation: {
        shimmer: "shimmer 1.5s ease-in-out infinite",
        toastup: "toastup 0.2s ease-out"
      }
    }
  },
  plugins: []
};
export default config;
