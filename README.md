# Mots Fléchés

Jeu de mots fléchés (arrow crossword) multijoueur en temps réel, pensé mobile-first / iOS.

## Stack

- **React + TypeScript + Vite**, Tailwind CSS — grid UI, mobile-first.
- **Framer Motion** — cell-fill pop, wrong-answer shake, win celebration.
- **Web Audio (synthesized)** — instant SFX with no binary assets to ship; **Howler** is wired up and ready for real sound-designed audio (see `src/lib/sounds.ts`).
- **Liveblocks** — realtime multiplayer (shared grid state + live cursors). Optional: the app runs single-player locally when no key is configured.
- **Serveur de grilles** (Python, `scripts/grid_generation/serve_puzzles.py`) — remplit des squelettes pré-construits à la demande. Optionnel : l'app retombe sur une grille de démonstration embarquée s'il est éteint.
- **vite-plugin-pwa** — installable on iOS home screen.

**Design**: animated gradient-blob background (`AuroraBackground.tsx`, pure CSS transforms), Fredoka (display/grid letters) + Nunito (clue text) via Google Fonts, glassmorphic cards for the scoreboard/session bar, haptic feedback on supported devices (`vibrate()` in `sounds.ts` — no-ops on iOS Safari, which has never implemented the Vibration API), and a sound mute toggle persisted in `localStorage`.

The app is fully playable with **zero configuration** (local single-player, bundled demo puzzle). Multiplayer and cloud content are additive — add the env vars below to turn them on.

## Local dev

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` on your phone (same Wi-Fi, use the `Network:` URL Vite prints) to test the mobile UI directly.

## Serveur de grilles (remplissage seul)

Les grilles ne sont plus embarquées : un petit service Python les fabrique à
la demande en remplissant des **squelettes pré-construits hors-ligne**. Il ne
cherche jamais de nouvelle structure — c'est ce qui rend la latence faible et
prévisible (~1 ms au lieu de plusieurs secondes).

```bash
cd scripts/grid_generation
python3 serve_puzzles.py            # http://127.0.0.1:8787
```

L'app appelle `GET /puzzle?seed=<session>-r<numéro>` et retombe sur la grille
de démonstration embarquée si le service est éteint.

- **`seed`** : indispensable en multijoueur. Le service est déterministe, donc
  deux joueurs d'une même partie obtiennent la même grille sans que le serveur
  ait à stocker quoi que ce soit. L'app y met `<session>-r<numéro de grille>`,
  de sorte que terminer une grille enchaîne les deux joueurs sur la suivante.

Il n'y a **qu'un seul dictionnaire et un seul banc** : la notion de difficulté
a été retirée au profit d'un dataset unique et bien plus large
(`scripts/datasets/mots_fleches_enriched_v6_hard_hints.json`, 4573 mots utilisables).
Le banc vit dans `scripts/grid_generation/banks/skeletons_8x8.json` et est déjà
construit. Pour le régénérer (opération lente, hors-ligne) :

```bash
python3 generate_grid_v2.py ../datasets/mots_fleches_enriched_v6_hard_hints.json \
    --build-bank 80 --bank-file banks/skeletons_8x8.json \
    --max-isolated 3 --max-dead-clues 7
```

Configurer l'URL du service via `VITE_PUZZLE_API_URL` (défaut :
`http://127.0.0.1:8787`).

## Enabling multiplayer (Liveblocks)

1. Create a project at [liveblocks.io](https://liveblocks.io) (free tier: 10 simultaneous connections/room, 3,000 collaboration-minutes/month — plenty for testing).
2. Copy the **public key** (starts with `pk_`) from your project's API keys page.
3. Copy `.env.example` to `.env` and set `VITE_LIVEBLOCKS_PUBLIC_KEY`.
4. Restart `npm run dev`. Open the app in two browser tabs — you should see the other player's cursor.

The public-key approach used here (`LiveblocksProvider publicApiKey=...`) is fine for prototyping since anyone with the key can join any room. Before a real launch, switch to an `authEndpoint` (a small backend route that mints a token per user) — see [Liveblocks auth docs](https://liveblocks.io/docs/authentication).

### How co-op sessions work

- On first load (with a Liveblocks key configured), the app mints a short session code and writes it into the URL as `?session=XXXXXX` (`src/lib/sessionCode.ts`) — that URL **is** the invite link. The "Inviter" button just copies `window.location.href` to the clipboard.
- The Liveblocks room id is `mots-fleches-{sessionCode}` — stable for the whole session, *not* per grid. It has to be: the shared `round` counter lives in that room's storage, and you'd need to know the round already to pick a per-grid room. Welcome side effect: scores accumulate across every grid of the session.
- **Scoring**: 1 point per word, credited to whoever's keystroke completes it. Attribution happens *inside* the `setLetter` Liveblocks mutation (`src/state/GameState.tsx`) — it reads the word's letters before and after the change, and only awards a point on an unsolved → solved transition, using `self.presence.playerId` from the mutation's own context. This runs once per mutating client, so it can't double-award or mis-attribute to whoever's screen happens to re-render.
- **Persistence / resuming**: Liveblocks Storage (`letters`, `scores`, `players` — see `liveblocks.config.ts`) persists in the room indefinitely; it's not tied to anyone being connected. Reopening the same session URL — alone or with others — reconnects to the exact same grid and scoreboard. The `players` map keeps each player's name/color even while they're offline, so the scoreboard can show "Alice (hors ligne) — 3 mots" for someone who scored earlier and left.
- **Player identity**: a stable per-browser id + display name live in `localStorage` (`src/lib/playerName.ts`), separate from Liveblocks' own `connectionId` (which changes every reconnect). This is what scores are keyed by, and it's why reloading resumes as the same player rather than a new one. Note this means identity is per-browser, not per-account — clearing site data or switching browsers starts a fresh identity.

Verified with two real browser tabs against a live Liveblocks project: cross-tab letter sync, live cursors, correct per-player score attribution, word-lock sync, and full state persistence across a hard reload (including the other player showing back online once reconnected).

## Enabling puzzle storage (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migration in `supabase/migrations/0001_init.sql` (SQL editor, or `supabase db push` if you use the CLI).
3. Insert a puzzle row (`published = true`) shaped like `src/data/demoPuzzle.ts`'s `words`/`clueCells` — or use `scripts/generate-clues.mjs` to draft clues first.
4. Copy `Project Settings → API → URL` and `anon public` key into `.env` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
5. Update `PUZZLE_ID` in `src/App.tsx` to the row's `id`.

Row-level security is set up so the anon key can only **read published puzzles** and **insert completion records** — puzzle authoring is intentionally left to the dashboard/SQL editor or a service-role script, never the browser key.

## Generating French clues

There's no ready-made open dataset shaped like *mots fléchés* clues (short, cell-sized hints). `scripts/generate-clues.mjs` drafts clue candidates in bulk with Claude, for human review:

```bash
npm install --no-save an-array-of-french-words
node -e "require('node:fs').writeFileSync('scripts/words.fr.txt', require('an-array-of-french-words').join('\n'))"

ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-clues.mjs --limit 200
```

This only drafts `{word, clue}` pairs — it does **not** lay out a grid (placing words so they interlock is a separate constraint-satisfaction problem). For that, see [mots-croises-generateur](https://github.com/Jean-Baptiste-DP/mots-croises-generateur) (Node, French by default) or [motscroises](https://github.com/laurentg/motscroises) (Java, GPLv3 — check license before bundling into a commercial app).

## Deploying (Vercel)

Le dépôt se déploie tel quel : `vercel.json` déclare explicitement le preset
Vite (sans lui, Vercel retombe sur le runtime Node et échoue avec
« No entrypoint found »), et `api/puzzle.py` devient une fonction serverless.

```
teamwword/
├── vercel.json          preset Vite + includeFiles pour la fonction
├── api/puzzle.py        GET /api/puzzle  (fonction serverless Python)
├── dist/                site statique (build)
└── scripts/
    ├── datasets/…json   dictionnaire (448 Ko, versionné)
    └── grid_generation/
        └── banks/…json  squelettes pré-générés (12 Ko, versionnés)
```

Le front appelle `/api/puzzle` **sur la même origine** — aucune variable
d'environnement à configurer pour que ça marche. En développement, le proxy
déclaré dans `vite.config.ts` renvoie `/api` vers le serveur Python local,
donc l'URL est identique des deux côtés.

Points importants :

- **Les squelettes sont générés en local et commités.** La fonction ne fait
  que du remplissage : pas de recherche de structure au démarrage à froid.
  Mesuré : ~60 ms de démarrage (chargement du dictionnaire + index + banc),
  puis quelques ms par grille.
- **`includeFiles: "scripts/**"`** est indispensable : sans lui, `scripts/`
  n'est pas embarqué dans le bundle de la fonction et elle ne trouve ni le
  dictionnaire ni le banc.
- **Aucune dépendance Python tierce** — tout est en bibliothèque standard,
  donc pas de `requirements.txt`.
- `VITE_PUZZLE_API_URL` ne sert qu'à viser un service hébergé ailleurs ;
  laissée vide, l'app utilise la même origine.
- Le palier gratuit (Hobby) est réservé à un usage non commercial ; un vrai
  lancement demande Pro (20 $/siège/mois).
- Supabase's free tier auto-pauses projects after a week of inactivity — fine for building, upgrade to Pro ($25/mo) before a real launch.

## Project structure

```
src/
  types/puzzle.ts          Grid/word/clue data model
  lib/gridBuilder.ts        Assembles a validated grid from word placements (throws on conflicts)
  lib/gridGeometry.ts       cellId / wordCellIds — shared by CrosswordGrid and the GameState scoring mutation
  data/demoPuzzle.ts        Bundled fallback puzzle (LION × OEUF × NEZ × OS × AMI)
  lib/sounds.ts             Synthesized SFX + Howler hookup
  lib/playerName.ts         Per-browser player identity (name + stable id) in localStorage
  lib/sessionCode.ts        Generates/reads the `?session=` invite code
  liveblocks.config.ts      Presence/Storage schema (module augmentation)
  lib/supabaseClient.ts, hooks/usePuzzle.ts   Puzzle content fetch
  state/GameState.tsx       Pluggable multiplayer/local game state + atomic scoring mutation
  components/               ClueCell, LetterCell, CrosswordGrid, CompletionCelebration, Scoreboard
supabase/migrations/        SQL schema
scripts/generate-clues.mjs  LLM-assisted French clue drafting
```

## Known follow-ups

- The production bundle is ~630KB (Liveblocks + Supabase + Framer Motion all load upfront even in local-only mode) — worth code-splitting with dynamic `import()` before a real launch.
- `npm audit` flags a moderate esbuild advisory in the dev-server-only request handling (fixed in Vite 8, a breaking upgrade) — doesn't affect production builds; left as-is for now.
- Accented-letter input via iOS long-press (e.g. holding "e" for "é") normalizes to the base letter, which is correct per crossword convention, but hasn't been tested on a physical device — worth checking during real device testing.
