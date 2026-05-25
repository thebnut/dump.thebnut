# dump.thebnut

A tiny multi-tenant hub for static HTML/CSS/JS prototypes.

- Per-user logged-in dashboard
- Zip upload → Vercel Blob hosting at `/p/<slug>/`
- Optional per-project password gate (multiple labelled passwords)
- Access log per project (timestamp, IP, UA, password label, path)
- Admin can manage users and view all projects

Implements Linear [THE-22](https://linear.app/thebnut/issue/THE-22/dumpthebnutcom).

## Stack

- Next.js 16 (App Router) on Vercel
- Auth.js (next-auth v5) — credentials provider, JWT sessions
- Drizzle ORM + Vercel Postgres
- Vercel Blob for project files
- Tailwind v4

## Local development

```bash
npm install
cp .env.example .env.local   # fill in POSTGRES_URL, BLOB_READ_WRITE_TOKEN, AUTH_SECRET
npm run db:push              # apply schema to your DB
npm run user -- you@example.com 'password' admin
npm run dev
```

Open http://localhost:3000 and sign in.

## Database

Schema lives in `src/lib/db/schema.ts`.
Migrations are generated to `drizzle/` via `npm run db:generate`.
Use `npm run db:push` for local development; use `npm run db:migrate` in production deploys.

## Routes

- `/login` — credentials sign-in
- `/` — dashboard (your projects)
- `/projects/new` — zip upload
- `/projects/[slug]` — manage (settings, passwords, access log, delete)
- `/p/[slug]/[[...path]]` — public file serving (gates protected projects)
- `/gate/[slug]` — password entry for protected projects
- `/admin` — admin: list users, create users, see all projects

## Security notes

- Passwords (user and project) are stored as bcrypt hashes only.
- Project gate cookies are HMAC-signed with `AUTH_SECRET`, 24h TTL.
- Access logs store the matched password's **label**, never the raw password entered.
- File serving streams through the origin so we can log each HTML page load and apply the gate.
- Path traversal in zip uploads is rejected (`../`, absolute paths, trailing-slash entries).
- 50 MB / 200 file upload cap.
- **Origin split**: uploaded prototypes are served from `content.thebnut.com`, not `dump.thebnut.com`, so JS inside a hosted prototype can't reach dashboard cookies or invoke Server Actions on the authenticated origin. Legacy `dump.thebnut.com/p/<slug>/` links 308-redirect to the content host, so anything shared before the split keeps working. See [`src/lib/origins.ts`](src/lib/origins.ts).

## Deployment

This app is deployed to Vercel from the `main` branch of this repo.
Custom domains (all point at the same Vercel project — the app host-routes internally):

- `dump.thebnut.com` — primary app host (dashboard, login, `/api/v1/*`, `/api/cron/*`).
- `url.thebnut.com` — alias of the app host.
- `content.thebnut.com` — user-content host (`/p/<slug>/*`, `/p/<slug>/sheet/*`, `/gate/<slug>`).

Required env vars on Vercel:

- `POSTGRES_URL` — set automatically by the Vercel Postgres integration
- `BLOB_READ_WRITE_TOKEN` — set automatically by the Vercel Blob integration
- `AUTH_SECRET` — generate with `openssl rand -base64 32`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (optional) — bootstrap a first admin if no users exist
- `NEXT_PUBLIC_CONTENT_URL` (optional) — override the content origin. Defaults to `https://content.thebnut.com` in production; preview/dev fall back to single-origin.

## Dynamic prototypes (Google Sheets backend)

dump only hosts static files, but a static prototype can talk to any HTTPS
endpoint — including a Google Apps Script Web App that wraps a Google
Sheet as a tiny CRUD API. See [`examples/todo-sheet/`](examples/todo-sheet/)
for a working todo-list SPA + Apps Script template + 5-minute setup guide.

The pattern:

```
[browser] ──fetch──▶ [Apps Script Web App] ──▶ [Google Sheet]
   ▲                       (user's Google account)
   │
served by dump as
a normal static project
```

No changes to dump are required. The user deploys their own Apps Script
(once per sheet, ~5 min) and pastes the URL into the prototype's JS.

## Bootstrapping the first admin

After the first deploy, either run locally against the production DB:

```bash
POSTGRES_URL='...' npm run user -- brett@thebault.co.uk 'pw' admin
```

Or set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` env vars and run `npm run seed` (no-ops if any user exists).
