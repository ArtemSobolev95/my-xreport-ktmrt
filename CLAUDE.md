# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Russian-language radiology/medical report builder ("Smart Reporting"). Users design a report *template* (a sequence of fields: header, text, number, checkbox, select, rating, notes, formula) in the Builder, then *fill* an instance of that template to generate a formatted report (highlighted HTML + plain text) that gets copied out.

## Commands

```bash
npm run dev      # start dev server (localhost:3000)
npm run build    # next build -> static export into out/ (see next.config.ts: output: 'export')
npm run start    # next start (rarely used — deployment serves the static export instead)
npm run lint     # eslint (flat config, eslint-config-next core-web-vitals + typescript)
```

There is no test suite/runner configured in this repo.

## Architecture

**Frontend**: Next.js 16 **Pages Router** (`pages/`), not App Router. `next.config.ts` sets `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true` — this is a static export (SPA-like), so App-Router-only features, API routes with server behavior, ISR, and next/image optimization are not in play here.

**Backend**: PocketBase (embedded SQLite), not a custom Node API. `lib/pocketbase.ts` creates the singleton `pb` client pointed at `NEXT_PUBLIC_POCKETBASE_URL` (defaults to the production instance). Auth state is persisted to `localStorage['pocketbase_auth']` and re-hydrated on load; `pb.authStore.onChange` keeps it in sync. Collections used throughout the app (not modeled in TypeScript, accessed as `any`): `users`, `templates`, `abbreviations`, `state_after_phrases`. Collection *schemas* live in the PocketBase admin UI/data, not in this repo — `pb_migrations/` only has the bootstrap admin-creation migration, and `pb_hooks/main.pb.js` just adds permissive CORS headers.

`lib/supabase.ts` configures a Supabase client from `NEXT_PUBLIC_SUPABASE_*` env vars but nothing in the app currently imports/uses it — treat it as a legacy leftover, not an active data path, unless you're specifically reviving it.

**Deployment**: `Dockerfile` builds the Next static export (`npm run build` → `out/`) and copies it into PocketBase's `pb_public/`, so a single PocketBase binary serves both the API and the static frontend on port 8090. `amvera.yaml` is the Amvera PaaS config for that container.

**Auth flow**: `components/withAuth.tsx` is a HOC that redirects to `/login` if `pb.authStore.isValid` is false; used to wrap protected pages (`pages/index.tsx`, builder/filler pages). Login additionally requires `pb.authStore.record?.verified` (see `pages/login.tsx`) — unverified users are logged back out with a message to check their email. `pages/verify.tsx` and the token-in-URL handling in `pages/login.tsx` both call `pb.collection('users').confirmVerification(token)` — there are two separate verification entry points, keep both in sync if you touch this flow.

**Core data model** (`types/builder.ts`): `BuilderField` (discriminated loosely by `FieldType`: header/text/number/checkbox/select/rating/notes/formula) is the shared shape used by both the Builder and the Filler. `QuickButtonGroup` (label + flat `phrases[]`) attaches canned phrases to a field. `lib/migrateQuickButtons.ts` upgrades an older two-level (group → subgroup → phrases) shape to the current flat shape on load — both `pages/filler.tsx` and `components/builder/TemplateBuilder.tsx` run templates through it, so any further quickButtons shape change needs to go through that migration function, not be assumed.

**The two big screens** are large, monolithic client components rather than decomposed into smaller pieces — expect to navigate within one file:
- `components/builder/TemplateBuilder.tsx` (~1200 lines): drag-and-drop (`@dnd-kit`) editor for composing/reordering `BuilderField`s into a template, persisted to the `templates` collection.
- `pages/filler.tsx` (~3000 lines): loads a template by `id` query param, renders inputs per field type, tracks per-field values in one `fieldsData` state map, maintains an undo history, autosaves an in-progress draft to `localStorage` (`filler_draft_<templateId>`), and derives the final report (`finalText` HTML + `finalPlainText`) via a big `useMemo` that walks `template.fields` in order.

**Formula fields** are evaluated with `new Function(...vars, 'return ' + expr)` in both TemplateBuilder (live preview) and filler.tsx (final report value) — dynamic expression evaluation is intentional here (report authors define their own math), but keep both evaluators behaviorally consistent if you change one.

**Styling**: Tailwind v4 + daisyUI, framer-motion for transitions, lucide-react + heroicons for icons. Dark theme (zinc-950 background, amber-400 accent). UI copy is in Russian — match that when adding user-facing strings.

## Known issue to be aware of

`pb_migrations/0001_create_first_admin.js` contains a hardcoded plaintext admin password committed to git. If you touch this file, don't reintroduce a literal credential — read it from an environment variable instead.
