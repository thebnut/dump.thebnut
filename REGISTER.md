# dump.thebnut — Build Register

End-of-build summary for Brett. Anything autonomous I did, decisions I locked
in, and the small set of things you need to click through in the Vercel UI to
get this fully live.

Linear issue: [THE-22](https://linear.app/thebnut/issue/THE-22/dumpthebnutcom)
GitHub repo: [thebnut/dump.thebnut](https://github.com/thebnut/dump.thebnut) (public)
Vercel project: `starblaze/dump.thebnut` (already linked to the GitHub repo)

---

## ✅ What's done

### Code
- Next.js 16 (App Router, Turbopack) + Tailwind v4 scaffolded
- Auth.js v5 (next-auth beta), credentials provider, JWT sessions, role on token/session
- Drizzle ORM + Postgres schema for `users`, `projects`, `project_passwords`, `access_logs`, `project_files`
- Initial migration generated at `drizzle/0000_tense_champions.sql`
- Vercel Blob integration for project file storage
- Login page with server-action sign-in
- Per-user dashboard listing projects, access counts, public/protected badge
- New project page: zip upload, slug autogen, optional first password (label + value)
- Project manage page: edit settings, add/remove passwords, view access log table, delete project
- Public file server at `/p/[slug]/[[...path]]`:
  - resolves entry path (default `index.html`, fallback first `.html`, fallback first file)
  - if protected, redirects to `/gate/[slug]` until cookie set
  - logs HTML page loads (not every asset) with timestamp/IP/UA/path/password label
  - streams file from Vercel Blob through origin
- Gate page at `/gate/[slug]` with HMAC-signed cookie scoped to `/p/`, 24h TTL
- Admin view at `/admin`: list users, create/update users, see all projects
- Auth proxy (Next 16 `proxy.ts`) gates routes — `/p/`, `/gate/`, `/login`, `/api/auth` are public
- TypeScript checks clean; `npm run build` passes locally

### Repo + deploy plumbing
- Public GitHub repo created under `thebnut` org, initial commit pushed
- Vercel project `dump.thebnut` created in `starblaze` team, GitHub repo connected
- `AUTH_SECRET` env var set on Production / Preview / Development (random 32-byte b64)

---

## 🔒 Decisions I locked in (overriding the issue's open questions)

1. **Publish flow** = zip upload from dashboard. No filesystem coupling, works from any device.
2. **Auth model** = admin-created credentials only. No self-serve signup.
3. **Stored passwords** = bcrypt hashes only. Never plaintext.
4. **Multi-password per project** = yes (e.g. label `martin`, label `launch-team`). Schema cost is trivial and matches "share with X vs Y" intent.
5. **Logs store password label only** = the human-readable label like `martin`, never the raw password. Logs also capture which row was matched (`password_label_id`).
6. **Admin visibility** = `role=admin` user can view all users + projects via `/admin`. Doesn't break the dashboard boundary for regular users.
7. **Cross-user direct links** = ownership doesn't block direct URL access. If someone has the URL + correct password, they're in. Ownership only scopes the dashboard view (Brett can't see Martin's dashboard, but Martin's project links work for anyone).
8. **Logging granularity** = log every HTML page load. Asset requests (CSS/JS/images) are NOT logged, to keep the per-project log readable. Unique-IP counts can be derived from logs later if you want.
9. **Upload caps** = 50 MB total, 200 files. Trivial to bump.
10. **Top-level zip folder stripping** = if a zip wraps everything in a single top-level dir (like the `reference-mockup/` example), it's stripped automatically so URLs stay clean.
11. **Entry file picker** = optional field on upload, defaults to `index.html`, falls back to first `.html` in zip, then first file.
12. **Cookie scope** = each project gate cookie is independent and scoped to `/p/`. Unlocking project A doesn't unlock project B.

---

## 🛠 What you (Brett) need to do — ~5 min in Vercel UI

The Vercel CLI's storage commands need an interactive TTY for the multi-select prompt, so I couldn't fully provision Postgres + Blob from my side. Five clicks each:

### 1. Create + connect a Postgres database
- Go to https://vercel.com/starblaze/dump.thebnut/stores
- Click **Connect Store** → **Create New** → **Neon (Serverless Postgres)**
- Name it `dump-thebnut-db`, choose `iad1` (or closest), connect to Production + Preview + Development
- Vercel auto-injects `POSTGRES_URL` (and friends) as env vars

### 2. Connect a Blob store
- Same Stores page → **Connect Store** → **Create New** → **Blob**
- Name it `dump-thebnut-files`, connect to Production + Preview + Development
- Auto-injects `BLOB_READ_WRITE_TOKEN`

> **Cleanup note:** I created two empty orphan Blob stores while figuring out the prompt issue (`store_bp5uh6PveYTbl8ze` aka `dump-thebnut`, and `store_RaPJs9rJ0hYdfBjJ` aka `dump-thebnut-files`, and `store_s34WYpEY6liWT98i` aka `dump-thebnut-store`). Delete any you don't end up using — they're empty and not linked. The harness blocked me from deleting them autonomously since blob deletes are destructive.

### 3. Run the database migration
Easiest path — pull env vars locally and run from this directory:
```bash
vercel env pull .env.local
npm run db:push
```
That applies the Drizzle schema to the new Postgres DB.

### 4. Create the first admin user
```bash
npm run user -- brett@thebault.co.uk 'YOUR_PASSWORD' admin
```
(or set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` env vars in Vercel and hit `npm run seed` after the next deploy)

### 5. Create Martin's user
```bash
npm run user -- martin@example.com 'their_password' user
```

### 6. Add the custom domains
- Vercel project → Settings → Domains
- Add `dump.thebnut.com` (primary)
- Add `url.thebnut.com` and select **Redirect to** `dump.thebnut.com` (or set them both as primary if you want both to serve directly — your call; the issue called it an "alias", a 301 redirect is the cleanest interpretation)
- DNS is already on Vercel for `thebnut.com` so the records will auto-provision

### 7. Trigger a redeploy
After Postgres + Blob are connected, push any commit (or hit "Redeploy" in the Vercel UI) so the new env vars are baked into the runtime. The first deploy I trigger from CLI may fail at runtime because the storage isn't connected yet — the *build* will succeed.

---

## 🚧 Things I didn't build (could be a follow-up)

- **Re-uploading a project** = right now you delete and re-create. Easy to add an "update zip" form.
- **Signed URLs / short-lived access** = currently the Blob URLs are public; we just don't expose them. If you want defence-in-depth, switch to signed URLs.
- **Rate limiting on the gate** = the password gate has no brute-force throttling. For low-traffic personal use it's fine; if you ever publish a high-stakes prototype, add Vercel Edge Config / Upstash rate limit.
- **Unique-visitor counts in the log header** = trivial `SELECT COUNT(DISTINCT ip)` query if you want it.
- **Project-list export / Linear sync** = none. Out of scope.
- **HTML rewriting for relative links** = none. Mockups should use relative paths like `./_shared.css`. The reference mockup at `jeen/docs/Module - Navigation & App Shell/reference-mockup` does this correctly.
- **Iframe / embedding controls** = no `X-Frame-Options` set. Add if you ever care.

---

## 🧠 Notes for future-you

- `src/lib/projects.ts` has the upload pipeline + safety checks (max 50MB / 200 files, path traversal rejected, MacOS noise filtered).
- `src/lib/gate.ts` has the cookie HMAC helpers — uses `AUTH_SECRET` for signing.
- `src/proxy.ts` (formerly `middleware.ts` — Next 16 renamed it) is the auth gate; `/p/`, `/gate/`, `/login`, `/api/auth` are public.
- Logs schema deliberately stores `password_label_used` as a denormalised text column AND a FK `password_label_id`. The text column survives password deletion; the FK lets you link back when it still exists.
- Build warning seen during `next build`: `Generating static pages... POSTGRES_URL is not set`. That's expected — the dashboard tries to render at build time. After Postgres is connected, this goes away (or all routes become dynamic anyway).
