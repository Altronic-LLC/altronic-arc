/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Cooper brand palette
        "cooper-red": "#CB2C30",
        "cooper-gray": "#707372",
        "ajax-yellow": "#F8C237",
        "cooper-green": "#009A44",
        "superior-blue": "#1C60AC",

        // Semantic tokens (driven by CSS vars in globals.css, so they flip
        // automatically when the .dark class is toggled on <html>)
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Open Sans"', "system-ui", "sans-serif"],
        display: ['"Barlow Condensed"', '"Open Sans"', "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 150ms ease-out",
        // A slower, plain opacity fade for the Reports kiosk cycle — 150ms
        // read as barely a flicker against a 60s dwell time (reported live,
        // 2026-09-17); this one is long enough to actually see. Its own
        // named animation rather than reusing "fade-in" at a new duration,
        // since a future caller of the fast one shouldn't inherit a kiosk
        // timing by surprise.
        "kiosk-fade": "kioskFade 1000ms ease-in-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        kioskFade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
