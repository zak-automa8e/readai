/**
 * Narwi · نروي — Tailwind preset (Tailwind 3.4).
 * Needs tokens.css loaded first: every colour reads an RGB-channel variable defined there,
 * so light/dark switch with the "dark" class and opacity modifiers (bg-primary/10) work.
 *
 * Usage (story 6):  presets: [require("../brand/tokens/tailwind.preset.js")]
 */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const pair = (name) => ({ DEFAULT: c(name), foreground: c(`${name}-foreground`) });

module.exports = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        border: c("border"),
        input: c("input"),
        ring: c("ring"),
        background: c("background"),
        foreground: c("foreground"),
        primary: pair("primary"),
        secondary: pair("secondary"),
        destructive: pair("destructive"),
        muted: pair("muted"),
        accent: pair("accent"),
        popover: pair("popover"),
        card: pair("card"),
        // Brand names, for the places a role name would hide the meaning
        lapis: c("primary"),
        "red-ink": c("red-ink"),
        highlight: c("highlight"),
        ornament: c("ornament"),
      },
      fontFamily: {
        // Latin display first; Arabic glyphs fall through to Amiri, so one class sets both scripts.
        display: ["Fraunces", "Amiri", "Georgia", "serif"],
        serif: ["Fraunces", "Amiri", "Georgia", "serif"],
        arabic: ["Amiri", "serif"],
        book: ["Amiri", "serif"],
        sans: ["Readex Pro", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
};
