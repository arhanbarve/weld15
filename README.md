# Weld 15

Interactive 3D model of Weld 15, a Harvard Yard freshman suite. Cinematic descent from an orbiting
globe down to the suite, then a fully manipulable room you can rearrange. Built with Next.js and
react-three-fiber, deployed on Vercel.

Not a Harvard product; data sources and attribution are shown in the UI.

## Stack

- Next.js 16 / React 19
- react-three-fiber, drei, three.js
- zustand (state)
- Vitest (unit tests), Playwright (e2e)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run typecheck` | TypeScript check, no emit |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:e2e` | Run e2e tests (Playwright) |
| `npm run plan` | Regenerate design plan SVG / layout |

## Project layout

```
app/            Next.js app router entry (layout, page, globals)
src/
  scene/        3D scene: journey stages, camera, geometry
  geo/          Campus/building geometry, georeferencing
  imagery/      Cyanotype/daylight imagery + shader treatment
  data/         Room graph, dimensions, source data
  state/        Zustand stores
  ui/           HUD, controls, overlays
scripts/        Data fetch, measurement, and capture tooling
tests/          Unit tests + tests/e2e (Playwright)
design/         Design renders, plan SVGs, layout docs
design-system/  MASTER.md design system spec
docs/           Implementation plan, phase docs, sources, audits
```

## Docs

- `docs/IMPLEMENTATION-PLAN.md` — goals, locked decisions, room graph
- `docs/SOURCES.md` — data provenance
- `docs/phases/` — per-phase (P0–P10) implementation notes
- `design-system/MASTER.md` — visual design system

## Testing

```bash
npm test          # unit tests
npm run test:e2e  # Playwright e2e (playwright.config.ts)
```
