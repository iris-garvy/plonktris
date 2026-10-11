# plonktris frontend

React + Vite single-page app. See the [root README](../README.md) for the full picture.

```sh
npm install
npm run dev        # http://localhost:5173, talks to the API at VITE_API_URL (default http://localhost:3000)
npm test           # vitest
npm run typecheck
npm run build      # → dist/
```

- `src/game/` — the game: `engine.ts` (the rules, mirrored by the Rust server), input handling,
  play sessions. Changes to `engine.ts` must be mirrored in `crates/server/src/engine.rs`.
- `src/components/` — `PuzzlePlayer` / `BoardEditor` (gameplay), `PlayView` / `CreateView`
  (the play and create pages), browse pages, modals.
- `src/api.ts` — the API client.
- `public/_redirects` (Cloudflare Pages) and `vercel.json` (Vercel) route every path to
  `index.html` for client-side routing.
