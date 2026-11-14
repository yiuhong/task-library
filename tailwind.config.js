/*
  Trial theme for the compiled sheet at assets/tailwind.css.

  One sheet serves the hub and every task page that used the Play CDN.
  Extend only colors those pages actually apply as utilities. Per-page
  tailwind.config blocks used to redefine the same keys with different
  values (trial.accent was emerald, sky, gold, or fuchsia depending on
  the file). Unused keys are left out so one palette cannot disagree
  with a page.

  Flanker colors stay CSS variables. assets/tasks/flanker.css owns the
  values, which is what the old Flanker config already did.

  Numerosity surface/panel and Go/No-Go ink were plain colors in their
  page configs. Those hex values are repeated here.

  font-mono matches Tailwind's default stack unless a page sets
  --trial-tw-mono. Corsi sets that to the JetBrains Mono stack its
  old config used.
  font-sans matches the Inter stack those page configs set. Inter is not
  a loaded face; the next family in the stack is used, as before.
*/

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './*_game.html',
    './assets/tasks/**/*.js',
    './assets/shells/**/*.js',
    './assets/hub-stage.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        trial: {
          surface: '#0d1322',
          panel: '#131c31',
        },
        bgBase: '#07090e',
        bgCard: '#0f141f',
        goLime: '#84cc16',
        nogoCoral: '#fb7185',
        bgPanel: 'var(--bg-panel, #12141d)',
        bgElevated: 'var(--bg-elevated, #1a1d2a)',
        accent: 'var(--accent-primary, #f43f5e)',
        accentHover: 'var(--accent-hover, #fb7185)',
        accentDim: 'var(--accent-dim, rgba(244, 63, 94, 0.15))',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // One custom property so Corsi can replace the whole stack.
        // The fallback after the comma is Tailwind's default mono stack.
        // var() keeps every comma inside that fallback.
        mono: 'var(--trial-tw-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
      },
    },
  },
  safelist: [
    'bg-amber-950/90',
    'bg-emerald-950/90',
    'bg-rose-950/90',
    'border-amber-500/40',
    'border-amber-500/60',
    'border-emerald-500/40',
    'border-emerald-500/60',
    'border-rose-500/60',
    'last:border-none',
    'opacity-100',
    'text-amber-300',
    'text-amber-400',
    'text-right',
    'text-rose-300',
    'text-rose-400',
    'w-16',
    'py-2.5',
  ],
  plugins: [],
};
