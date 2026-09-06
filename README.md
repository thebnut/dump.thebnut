# dump.thebnut

## Brett Toolkit Discord reader

The owner-only `/mcp` connection includes six read-only Discord tools: list servers,
list channels and active threads, list archived threads, read history, retrieve a
message, and search. `get_workflow` accepts `discord-review` for the portable review
instructions. These tools use Baz's existing bot through Discord REST; they create
no second Gateway session and do not read or acknowledge his local inbox.

Configure `BAZ_DISCORD_BOT_TOKEN` as a sensitive production environment variable
using Baz's existing credential, without resetting it. Set `BAZ_DISCORD_GUILDS` to
the JSON array of `{id, name}` entries from the existing listener configuration.
No credentials or private server IDs belong in the plugin bundle or repository.
The allowlist is a deployment snapshot; update it when Baz's configured servers
change. Channels and threads within those servers are discovered live.

Discord tools require the separate OAuth scope `discord:read`. Existing publishing
grants cannot acquire it through refresh: refresh the ChatGPT connection's tool
metadata, reconnect and consent to Read Discord messages. The authorisation screen
describes the access. Production remains restricted to `TOOLKIT_OWNER_ID`.

For a time-window review, send `since`, then page backwards using `next_before`
with the same `since` until `window_complete`. Read thread histories separately.
Permission failures, search indexing and rate limits return explicit errors.
This version has no scheduler, persistent review cursor, DM access or Discord
write tools. Recurring reviews need a separately configured cloud task and durable
review boundaries. Skills are also served through `get_workflow` for cloud clients.

Run `npm test` and `npm run build`. With the two Discord environment variables
configured securely, `npx tsx scripts/check-discord-reader.ts` verifies discovery,
one history sample per configured server and indexed search without printing
messages or credentials.

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
