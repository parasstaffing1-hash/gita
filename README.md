# Bhagavad Gita Platform

A calm, premium Bhagavad Gita companion: a mobile app, an SEO-first website, a
shared API, an admin/content system, and a grounded "Ask the Gita" search.

The organising principle is simple and it drives most of the architecture:

> **Scripture is never generated.** Canonical text is authored and reviewed by
> people, stored with its source and licence, hashed so drift is detectable, and
> served read-only. The AI layer may explain, cite and retrieve. It may not
> write, translate, complete or alter a verse.

---

## Contents

- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Database setup](#database-setup)
- [Environment variables](#environment-variables)
- [Running locally](#running-locally)
- [Content import](#content-import)
- [Testing](#testing)
- [Cloudflare R2](#cloudflare-r2)
- [Deployment notes](#deployment-notes)
- [Current status](#current-status)

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
   apps/mobile ────▶│                                          │
   (Expo, SQLite)   │            apps/api  (FastAPI)           │
                    │                                          │
   apps/web    ────▶│  routers ─▶ services ─▶ SQLAlchemy       │──▶ PostgreSQL 16
   (Next.js SSG)    │                 │                        │    + pgvector
                    │                 ├─ gita_search           │    + pg_trgm
   apps/admin  ────▶│                 ├─ gita_ai               │    + unaccent
   (Next.js)        │                 ├─ gita_embeddings       │
                    │                 ├─ gita_ingestion        │
                    │                 └─ gita_audio            │
                    └──────────────────────────────────────────┘
                                      │
                                      └──▶ Cloudflare R2 (audio, share assets)
```

Everything is one database. No Elasticsearch, no separate vector store, no
Kubernetes — PostgreSQL does full-text (`tsvector`), fuzzy matching (`pg_trgm`)
and semantic retrieval (`pgvector`) in one place, which is both cheaper and
easier to keep consistent at this scale.

### Design decisions worth knowing

**Canonical vs. generated content.** `content_licenses`, `content_sources` and
an `origin` column (`canonical` / `curated` / `ai_generated`) run through every
content table. `gita_api.security.content_guard` installs a SQLAlchemy
`before_flush` hook: inside the AI request path, any attempted write to a
canonical table raises. The protection lives at the session boundary rather
than in each call site, so it cannot be forgotten.

**Verification states.** Every content row is `draft → review → verified →
published`. A row may only reach `verified`/`published` if its
`content_sources` row is marked authoritative. A development placeholder
therefore cannot present itself as checked text, and the importer clamps status
automatically for bundles that declare `"authoritative": false`.

**Canonical hashes.** Every text row stores a SHA-256 over its NFC-normalised,
whitespace-collapsed content. If a stored hash stops matching its text, the row
was changed outside the audited path. The same normalisation is implemented in
Python and TypeScript and covered by shared fixtures.

**Grounded answers.** `/v1/ask` runs: normalise → detect language → hybrid
retrieval → load verified verses and *approved* commentary → build a
constrained context → LLM writes the explanation only → strip any Devanagari
the model produced itself → validate every citation against the retrieved
context → persist query, answer and validated sources. Verse text in a citation
is read out of the database; the model supplies only the reference. A reference
that cannot be matched is removed and recorded in `rejected_citations`.

**Semantic similarity is not evidence.** A vector search always returns its k
nearest neighbours, so an off-topic question still gets confident-looking
numbers. The grounding gate requires corroboration from a retriever that can
return nothing — an exact reference, a full-text hit, a fuzzy term match or a
curated topic mapping — and accepts semantic alone only at high similarity.
Questions the library cannot answer are declined rather than answered badly.

**Provider independence.** `services/ai` defines `AIProvider` with
`generate` / `stream` / `embed` / `health_check`, and adapters for OpenAI,
Anthropic, Gemini, OpenRouter, Groq and Ollama/local. Switching is an
environment change. Embeddings deliberately stay independent of the chat
provider, so changing chat vendors never invalidates the vector index.

---

## Folder structure

```
bhagavad-gita/
├── apps/
│   ├── api/                    FastAPI service (Python)
│   │   ├── gita_api/
│   │   │   ├── db/models/      SQLAlchemy models (41 tables)
│   │   │   ├── routers/        HTTP endpoints
│   │   │   ├── schemas/        Pydantic request/response models
│   │   │   ├── security/       auth, rate limiting, canonical write guard
│   │   │   ├── services/       read-side queries, search, ask, media
│   │   │   └── utils/          verse refs, normalisation, hashing
│   │   ├── alembic/versions/   migrations
│   │   ├── scripts/            import_content, reindex_search, bootstrap
│   │   └── tests/              pytest
│   ├── web/                    Next.js website (App Router, SSG-first)
│   ├── admin/                  Next.js admin panel
│   └── mobile/                 Expo app (React Native)
├── packages/
│   ├── gita-types/             shared TypeScript domain types
│   ├── api-client/             typed API client
│   ├── content-schema/         Zod schema for content bundles
│   ├── design-tokens/          colour, type, spacing, Tailwind preset
│   ├── localization/           en + hi UI bundles
│   ├── shared-utils/           verse refs, normalisation, hashing
│   └── validation/             Zod schemas for client input
├── services/
│   ├── search/                 hybrid retrieval + index builder
│   ├── ai/                     provider abstraction + grounding
│   ├── embeddings/             pluggable embedding providers
│   ├── ingestion/              content importer + change logging
│   └── audio/                  R2 object-key conventions
├── content/                    content bundles (see content/README.md)
└── infrastructure/docker/      local PostgreSQL with extensions
```

---

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 20.11 | 22 or 24 also fine |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Python | 3.11 or 3.12 | 3.12 is what this was built against |
| Docker | any recent | for local PostgreSQL only |

---

## Installation

```bash
git clone <repo> && cd bhagavad-gita
cp .env.example .env
pnpm install
```

Python API and the local service packages:

```bash
cd apps/api
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

`requirements.txt` installs the API plus `services/*` in editable mode, so an
edit in `services/search` is picked up without reinstalling.

---

## Database setup

```bash
pnpm db:up          # PostgreSQL 16 + pgvector on localhost:5433
```

Port 5433 is deliberate — it avoids colliding with a PostgreSQL you may already
run on 5432.

The container creates the extensions on first start. Migration `0001` also
creates them, so a managed database (Neon, Supabase, RDS) works without the
container.

```bash
cd apps/api
alembic upgrade head
python -m scripts.bootstrap                    # languages
python -m scripts.bootstrap --admin-email you@example.com   # + an admin user
```

### Extensions

| Extension | Used for |
| --- | --- |
| `vector` | semantic retrieval (`embeddings.embedding`, HNSW cosine index) |
| `pg_trgm` | fuzzy transliteration matching (krsna / krishn / कृष्ण) |
| `unaccent` | diacritic folding inside the `gita_simple` text search config |
| `btree_gin` | composite GIN indexes |

Migration `0001` also creates a `gita_simple` text search configuration that
folds accents before indexing and does **not** stem — English stemming would
mangle transliterated Sanskrit.

---

## Environment variables

Copy `.env.example` to `.env`. The values that matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://gita:gita@localhost:5433/gita` | |
| `API_SECRET_KEY` | dev placeholder | **must** be generated in production; the app refuses to start otherwise |
| `ADMIN_API_TOKEN` | dev placeholder | bootstrap token for scripts |
| `AI_PROVIDER` | `echo` | `openai` / `anthropic` / `gemini` / `openrouter` / `groq` / `ollama` / `echo` |
| `AI_API_KEY` | empty | required for any hosted provider |
| `EMBEDDING_USE_STUB` | `1` | `0` uses the real multilingual model (downloads weights) |
| `R2_*` | empty | required for audio and share assets |
| `SENTRY_DSN`, `POSTHOG_KEY` | empty | optional |

`AI_PROVIDER=echo` is a deterministic offline provider. It never invents
scripture — it summarises the grounded context it was given — so the whole Ask
pipeline is exercisable with no API key and no network.

No secret is ever exposed to a client bundle. The apps talk only to this API,
which holds the AI and R2 credentials.

---

## Running locally

Four terminals, or pick what you need:

```bash
pnpm db:up                                              # 1. PostgreSQL

cd apps/api && uvicorn gita_api.main:app --reload       # 2. API   :8000

pnpm --filter @gita/web dev                             # 3. Web   :3000
pnpm --filter @gita/admin dev                           # 4. Admin :3002
pnpm --filter @gita/mobile start                        #    Mobile (Expo)
```

Or `pnpm dev` to run the JS apps together through Turborepo.

- API docs: <http://localhost:8000/docs> (disabled in production)
- Health: <http://localhost:8000/health> — reports database, extensions and AI provider

> **Do not run `next build` while `next dev` is running** on the same app: both
> write to `.next` and the dev server will start throwing `MODULE_NOT_FOUND`.
> If that happens, `rm -rf apps/web/.next` and restart.

### Monorepo pins worth knowing

pnpm's isolated layout and Expo's version coupling interact badly in a few
specific places. Each of these is pinned deliberately; loosening one breaks the
Metro bundle, not just a type:

| Pin | Why |
| --- | --- |
| `babel-preset-expo: ~13.0.0` (workspace override) | Babel resolves a preset relative to the file it transforms. A file inside `node_modules` otherwise picked up 13.2.5 (the SDK 54 line), which expects Reanimated 4's worklets plugin. |
| `nativewind: 4.1.23` (exact) | 4.2.x pulls `react-native-css-interop` 0.2.6, whose Babel entry unconditionally loads `react-native-worklets/plugin` — a Reanimated 4 package. SDK 53 ships Reanimated 3. |
| `react-native-css-interop` declared directly | The nativewind JSX runtime re-exports from it, so app code compiled with `jsxImportSource: nativewind` imports it by name. A transitive dep is not reachable that way under pnpm. |
| `@expo/metro-runtime` declared directly | `expo-router/entry` imports it, same reason. |
| `disableHierarchicalLookup: false` in `metro.config.js` | pnpm resolves a package's own dependencies through the `node_modules` beside its real location in the store. Disabling the upward walk breaks every transitive import. |
| Relative imports in `packages/*` carry no `.js` extension | Next and Metro both compile these from TypeScript source with bundler resolution, where an explicit `.js` points at a file that does not exist. |

---

## Content import

Content lives in `content/` as JSON bundles validated by
`packages/content-schema`. See [`content/README.md`](content/README.md) for the
format and for what a publishable dataset still needs.

```bash
cd apps/api
python -m scripts.import_content ../../content --all --dry-run   # validate only
python -m scripts.import_content ../../content --all
python -m scripts.reindex_search --embed
```

The importer is idempotent, runs one transaction per bundle, and rolls the
whole bundle back on any error. Any change to existing canonical text writes a
`content_change_log` row with the previous value, the new value, the editor and
the reason.

**Everything currently in `content/` is `"authoritative": false`** and imports
as `draft`. It exists so the reader, search and Ask pipelines can be exercised
end to end. It is not a publishable edition of the Gita, and the UI labels it
as unverified wherever it appears.

Do not scrape modern translations. Most contemporary English and Hindi
translations are in copyright; using one needs written permission recorded in
the source's `copyrightStatus` and `verificationNotes`.

---

## Wallpapers and the quote maker

`/create` lets a reader put a verse on a 4K wallpaper or a share card. The
verse text always comes from the API — only the caption is theirs — so a card
cannot carry a hand-typed shloka, and a share link stores the *reference*
rather than the text, which means a correction to the verse reaches every card
ever shared.

### Generating the starter library

A thousand licensed photographs is a procurement job. `generate_wallpapers.py`
produces original artwork the project owns outright in the meantime: 12
palettes crossed with 20 motifs (temple shikharas, ghats, banyan, diyas,
peacock feather, chakra, mandala, cusped arch, dunes, mountains, stars, birds,
clouds, rays, ripples, water, lotus, arcs, glow, plain), portrait and
landscape.

```bash
python infrastructure/scripts/generate_wallpapers.py --out media-src/wallpapers
python infrastructure/scripts/generate_wallpapers.py --out media-src/wallpapers \
    --variants 4 --skip-existing        # 1,176 images; leaves existing ones alone
```

`--variants` re-rolls only the motifs whose composition comes from the random
seed — ridge lines, tree shapes, star fields, lamp counts. Fixed-geometry
motifs (lotus, chakra, mandala, feather, arch, plain, arcs) are generated once
per palette, because a second copy of the same drawing is a filename, not a
wallpaper.

Every motif draws in silhouette or thin line work and leaves one third of the
frame calm. The gradient carries the colour, the motif carries the shape, and
the verse still has to read over both.

### Importing

```bash
cd apps/api
python scripts/import_wallpapers.py ../../media-src/wallpapers \
    --manifest ../../media-src/wallpapers/manifest.json --prune
```

The importer measures each image rather than trusting the manifest: it splits
the frame into thirds, scores each by variance, and records the calmest as
`text_zone` plus its mean brightness as `luminance`. The composer uses both —
picking a wallpaper sets the layout that puts the verse where the picture is
quietest, and `tone: auto` sets the type light or dark from the measurement.

It is resumable by checksum, isolates per-image failures, writes 1440px and
480px WebP derivatives, and **requires a licence block in the manifest** — a
wallpaper cannot be published without one (`published_wallpaper_needs_licence`).

A thousand-image run is an hour of work, so it is built to survive being
interrupted:

* `--batch-size` (default 25) commits as it goes. Canonical scripture stays
  all-or-nothing — a half-imported bundle is a half-truth — but a half-imported
  wallpaper library is just a smaller library, and everything lands as `draft`
  regardless. Pass `0` for a single transaction.
* Derivatives newer than their source are reused, so a resumed run does not
  resample every 4K image again.
* `--prune` deactivates catalogue rows whose image is no longer in the source
  set. It never deletes — a wallpaper someone already put on a card should stop
  being offered rather than start 404ing — and it is skipped entirely if any
  image failed, since a run that could not read half its images has no business
  deciding what is missing.

Re-importing never overwrites `verification_status` or `is_active`, so it
cannot undo a review. The one exception runs the other way: if the *file* behind
an already `verified` or `published` slug changes, the wallpaper is moved back
to `review` with an audit row, because what the reviewer approved is no longer
what readers would get.

Wallpapers import as `draft` and are published from **Admin → Wallpapers**, the
same lifecycle as verse content. That screen reviews in batches under one
reason — a library arrives hundreds of images at a time under a single licence,
and a thousand individual clicks would only teach a reviewer to stop reading
what they approve. Every row still gets its own `content_change_log` entry, and
a batch containing one unlicensed image fails whole rather than publishing the
rest.

Wallpapers can also be hidden from the picker without being deleted, because
someone may already have a card on that background and the file has to keep
resolving after the image stops being offered.

### Storage

Object keys are `wallpapers/{full,preview,thumb}/<slug>-<digest>.<ext>` in R2,
where `digest` is the first twelve hex characters of the source image's
SHA-256. The digest is what makes a key immutable: the bytes at a given key
never change.

That matters because a wallpaper carries a review. Keyed on the slug alone,
re-importing a changed file replaced the object *at the URL readers already
held*, and did so before the row was moved back to `review` — so an image
nobody had approved was already being served out of CDN and browser caches that
had no reason to revalidate. The database protection was real and the object
store had none. With the digest in the key a replacement is a new object, and
what a reviewer approved stays exactly where it was approved.

`parse_wallpaper_key` still reads keys written before keys carried a digest, so
a bucket listing can be reconciled against a catalogue that holds both.

While R2 is unconfigured the API serves the identical key layout from `media/`
at `/media/...`, so moving to R2 is a credential change and nothing else. That
mount is refused outright in production, where a missing R2 configuration is a
deployment error rather than a convenience.

---

## Testing

```bash
cd apps/api && pytest                       # 154 tests
cd apps/api && ruff check . && ruff format --check .

pnpm --filter @gita/web test                # 76 unit tests (Vitest)
pnpm --filter @gita/web test:e2e            # 36 E2E tests (Playwright)
pnpm --filter @gita/web build

pnpm --filter @gita/mobile typecheck
cd apps/mobile && npx expo export --platform android   # proves the bundle builds
```

E2E runs against a server that is already up (`E2E_BASE_URL=http://localhost:3000`)
or starts one, and expects the API running with content imported — the point is
to check real pages, not mocks. Both viewports (desktop and a Pixel 7) run.

Tests that need PostgreSQL are marked `@pytest.mark.db` and skip automatically
when no database is reachable, so `pytest` works on a fresh clone.

Critical behaviour under test:

- verse reference parsing across 15 input forms, in Python and TypeScript, from
  one shared fixture file
- all 700 verse ordinals unique and contiguous; navigation across chapter
  boundaries
- canonical hash stability under whitespace and Unicode normalisation form
- the AI write guard, and refusal to publish from a non-authoritative source
- citation validation: references outside the retrieved context are stripped
- the generated-scripture guard: model-authored Devanagari is removed
- insufficient-evidence refusal on thin retrieval
- API authorisation: guests read, users sync, only admins reach `/v1/admin`
- content bundles: provenance present, no unverified bundle claiming verified
  status, chapter counts matching the 700-verse recension
- the verse page ships Sanskrit, transliteration and translation in the HTML
  (asserted on the raw response, so it fails if content moves behind JS)
- share cards render as real PNGs in all three sizes
- the sitemap lists all 700 verses; robots excludes `/search`
- one `h1` and a skip link on every page; the reading theme survives a reload

### Regressions worth keeping

Five defects were found by exercising the running system rather than by
unit-testing its parts. Each now has a test named after the behaviour it
protects:

| Defect | Why the existing tests missed it |
| --- | --- |
| passlib 1.7.4 cannot hash any password against bcrypt 5.x, so registration and login both returned 500 | The contract tests only asserted that endpoints *reject* anonymous callers, never that sign-up works. Fixed by calling bcrypt directly with a SHA-256 pre-hash. |
| `/v1/sync/pull` raised `AttributeError` — `CollectionItem` has no `user_id` | No test had ever pulled with a collection item present. |
| Any signed-in account could overwrite another account's collection item | The ownership check read a missing `user_id` as `None` and treated `None` as permission. Ownership is now resolved per entity. |
| The canonical write guard was installed from the FastAPI lifespan, so every CLI script ran unguarded | The guard was only ever tested through the web app. It is now installed by `get_session_factory()`, so no session can exist without it. |
| A brief API outage made verse pages return 404, and Next cached that for an hour | `fetchOrNull` treated a network failure as "not found". "The server says this does not exist" and "I could not reach the server" are now handled differently. |

---

## Cloudflare R2

Audio, share images and downloadable bundles live in R2. Set `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and
`R2_PUBLIC_BASE_URL` if you serve through a CDN domain. Without a public base
URL the API issues short-lived signed URLs instead.

Object keys are zero-padded so a lexicographic bucket listing is also reading
order:

```
audio/sa/verse/02/047.mp3
audio/sa/chapter/02.mp3
audio/en/reflection/2026-09-04.mp3
```

`audio_tracks.is_synthetic` is mandatory and surfaced in the UI. Synthesised
speech is never presented as recitation.

---

## Deployment notes

Cheap and boring on purpose:

- **API** — one container. `uvicorn` behind a reverse proxy. Rate limiting is
  in-process; if you run more than one instance and need shared limits, point
  `slowapi` at Redis.
- **Database** — any managed PostgreSQL 16 with `vector`, `pg_trgm` and
  `unaccent`. Neon and Supabase both work.
- **Web** — Vercel, or `next build && next start` in a container. Canonical
  pages are statically generated with `revalidate`, so most traffic never
  reaches the API.
- **Media** — R2, with a CDN domain in front.
- **Mobile** — EAS Build.

Before going live: generate `API_SECRET_KEY`, set `ENVIRONMENT=production`
(which disables `/docs` and restricts responses to `published` content only),
rotate `ADMIN_API_TOKEN`, and set real CORS origins.

---

## Current status

Working end to end and verified against a live database:

**Backend** — 42-table schema, three migrations, all extensions. Content
ingestion with provenance, change logging and idempotent re-import. 34
endpoints. Hybrid search across references, Devanagari, IAST, Hinglish and
natural-language questions. Grounded Ask pipeline with citation validation and
honest refusal.

**Website** — chapters, verse reader, topics, glossary, reading plans, search,
Ask, start-here. Sitemap with 770 URLs, robots, JSON-LD, canonical and OG tags.
Share cards rendered on demand in three sizes. Light, sepia and dark.

**Quote maker** — `/create` composes a verse onto a 4K wallpaper in six
formats and five layouts, rendering to the same canvas that is downloaded.
Backgrounds come from a generated library the project owns outright; each is
measured at import so the verse lands where the picture is quietest and the
type is set light or dark to match. Share links carry the composition and the
verse reference, never the verse text.

**Admin** — dashboard, content browser, canonical change log with inline diffs
and rollback, AI answer review queue, wallpaper review with batch publish and
a licence gate. Every canonical edit requires a reason,
writes an audit row, and cannot publish from a non-authoritative source.

**Mobile** — Expo Router app that bundles cleanly for Android. SQLite mirror of
the canon with FTS5 offline search, reader preferences, bookmarks, highlights,
notes, collections, reading progress and memorisation — all working signed out,
all marked for sync. Home, Read, Explore, Ask and Library tabs, plus chapter,
verse, topic, glossary, plan, memorise and settings screens.

### Not built yet

- **Audio playback.** The schema, R2 key conventions, download bookkeeping and
  the `is_synthetic` flag are all in place; the player and download manager are
  not written, and there are no audio files to play until recordings are
  licensed.
- **Sign-in UI.** The API has registration, login, refresh and conflict-safe
  sync; the mobile and web screens that drive them are not built. Everything
  works signed out in the meantime, which is the intended default.
- **Notifications.** `expo-notifications` is configured and the preferences
  table exists; scheduling is not wired up.
- **Photographic wallpapers.** The library is original generated artwork, not
  photography. The import pipeline is built for a licensed photo set —
  resumable, per-image failure isolation, licence required before publish — but
  the photographs themselves are a procurement task.
- **Verified content.** This is the real blocker for launch, and it is an
  editorial and licensing task rather than an engineering one. See
  [`content/README.md`](content/README.md).
