---
name: dump-thebnut
description: Upload static HTML/CSS/JS prototypes to dump.thebnut for hosting and sharing. Use when the user wants to publish a mockup, share a wireframe, "dump" a folder, push a static prototype, host an AI-generated HTML file, or get a shareable URL for HTML they have locally. Accepts a folder (zips it) or a single .html file, with optional CRUD persistence via a linked Google Sheet and optional auto-expiry (TTL) for throwaway prototypes. Requires DUMP_TOKEN env var (get one at https://dump.thebnut.com/settings).
---

# dump.thebnut

> **Updated 2026-05-26.** Prototype URLs now live on `content.thebnut.com/p/<slug>/` (used to be `dump.thebnut.com/p/<slug>/`). Old share-links 308-redirect, so nothing breaks. The API itself stays on `dump.thebnut.com/api/v1/*`. If you read `.project.url` from API responses (every bash recipe below does), no code changes are needed — output is auto-correct. Re-fetch this file from `https://dump.thebnut.com/dump-thebnut.skill.md` to get the latest examples.

Tiny hosted hub for throwaway HTML/CSS/JS prototypes. Upload a folder OR a single HTML file → get back a stable URL at `https://content.thebnut.com/p/<slug>/`. Optional per-project password gate, optional TTL for auto-expiry, optional Google Sheet backend for CRUD apps. Access logs visible in the dashboard.

## Two hosts

- **`dump.thebnut.com`** — dashboard, settings, and the bearer-auth API. All `curl` calls below go here.
- **`content.thebnut.com`** — where uploaded prototypes are served. The `project.url` field in API responses points here. Legacy `dump.thebnut.com/p/<slug>/` links 308-redirect to the content host, so anything shared before the split keeps working.

When reporting the URL back to the user, **always use the `.project.url` from the API response** — don't construct it from the slug yourself.

## When to use this skill

Trigger when the user says any of:
- "dump this", "dump this folder", "dump this html", "dump the site"
- "upload this prototype", "publish this mockup", "share this wireframe"
- "host this html file", "get me a URL for this", "share this"
- references "dump.thebnut" or "dump"

Don't use for production deploys (Vercel, Netlify, npm publish).

## Setup (one-time per machine)

The skill needs `DUMP_TOKEN` in the environment.

```bash
echo $DUMP_TOKEN
```

If empty, **stop and ask the user** to:
1. Sign in at https://dump.thebnut.com/settings
2. Click `[create token]`, name it (e.g. `claude-code`)
3. Copy the `dt_live_…` value (shown only once)
4. Add to their shell: `export DUMP_TOKEN=dt_live_...`

Don't proceed without the token — every endpoint will 401.

## Compatibility & features — what you can build

Three patterns, all hosted as static prototypes at `https://content.thebnut.com/p/<slug>/`. Decide which one fits BEFORE writing any code — the choice determines build constraints + which upload flow to use.

### 1 · Single-file HTML

A self-contained `.html` file. Inline `<style>` + `<script>`. Images either inlined as base64 or hot-linked from a CDN. JS libraries via CDN `<script>` tag (Alpine, htmx, Vue UMD, React UMD, p5.js, three.js, Tailwind CDN, etc.) are fine.

**Pick when:** one-shot mockup, AI-generated demo, single-page tool, visualisation. The default for "Claude, dump me an HTML".

**Don't pick when:** the build output already has separate CSS/JS files, or assets exceed ~100 KB each (base64 bloats the HTML; just use bundle).

**Hard limits:** 50 MB total. No server-side runtime.

→ See "Upload a single HTML file" below for the curl recipe.

### 2 · HTML bundle (multi-file)

A folder of HTML/CSS/JS/image/font files, zipped on upload. Up to 200 files, 50 MB total. Multi-page apps, framework builds, reference mockups with shared `_shared.css` patterns, anything where keeping files separate is cleaner.

**Pick when:** more than one HTML file, separate stylesheet, separate image assets, framework build output.

**Don't pick when:** the prototype needs to persist user input across reloads — use option 3.

**Framework build gotcha:** absolute paths like `/assets/foo.js` are server-side rewritten to `/p/<slug>/assets/foo.js`. Static `<script src>` works. But dynamic `import("/assets/...")` in JS bundles 404s — those need a build-time base path: `vite build --base=./` (Vite), `"homepage": "."` in `package.json` (CRA), `basePath` in `next.config.js` for Next static export.

**Hard limits:** static-only. No SSR. No serverless functions. No Node modules at runtime — only what your bundler statically resolved into the JS.

→ See "Upload a folder (zip flow)" below.

### 3 · CRUD app with Google Sheet backend

Same shape as 1 or 2, PLUS your client-side JS does same-origin fetches to `sheet/rows` for dynamic data persistence. The sheet acts as the database; dump's server proxies reads/writes via a service account that the project owner shares the sheet with on the manage page.

**Pick when:** the prototype needs to persist user input — todo lists, guestbooks, feedback forms, leaderboards, simple admin panels, mood trackers, polls. Anything you'd otherwise reach for Supabase/Firebase for and immediately regret the per-tenant complexity.

**Don't pick when:**
- You need per-user authentication. The sheet endpoint is anonymous (or gated by the project password if set). There's no "logged-in user". Tell the user this if they ask.
- The data is sensitive (PII, regulated, financial). Rows live in a Google Sheet shared with a service account. Not the right place.

**The CRUD contract** — what your client-side JS calls:

| Browser                           | Server returns                            |
| --------------------------------- | ----------------------------------------- |
| `GET sheet/rows`                  | `[{ id, ...columns }]` — all rows         |
| `POST sheet/rows`, JSON body      | `{ id, ...columns }` — id auto-set        |
| `PATCH sheet/rows/<id>`, JSON     | `{ id, ...columns }` — only sent fields updated |
| `DELETE sheet/rows/<id>`          | `{ deleted: true, id }`                   |

URLs are **relative** (just `sheet/rows`, not `/sheet/rows`). dump injects `<base href="/p/<slug>/">` server-side so they resolve to the right project. Means your SPA doesn't need to know its own slug and works wherever it gets uploaded.

**Conventions you must follow:**
- First row of the sheet is the column schema. First column is `id` (auto-managed; never write to it from your JS).
- Booleans come back from Sheets as `true` / `false` OR strings `"TRUE"` / `"FALSE"` depending on cell format. Handle both: `t.done === true || t.done === "TRUE"`.
- Don't try to manage `id` from the client — the server always generates a UUID; any client-supplied `id` is dropped (defence against formula injection).
- Body cap: **64 KB** per write. Rate limit: **30 ops/min per IP per project**. Tell the user if they're building something that'll legitimately exceed either.
- All POSTs use `Content-Type: application/json`. The proxy is same-origin so CORS isn't a concern.

**After uploading**, tell the user (literally — substitute the real `project.url` from the response):
> Published to <project.url> — but it's not wired to a sheet yet. Open the manage page (https://dump.thebnut.com/projects/<slug>), share a Google Sheet with the displayed service-account address (Editor access), paste the sheet URL, click [link]. Then the prototype works.

→ See "Dynamic data via Google Sheets" for the full setup steps + the alternative Apps Script flavour.

### Optional add-on: TTL (any pattern)

Any of the three patterns can carry an `expiresIn` / `expiresAt` so the prototype auto-deletes after a duration. Default to `expiresIn=7d` for throwaway / "show this to X" / one-shot uploads. → See "Auto-expire (TTL)".

## Upload a single HTML file

```bash
FILE="${1:-./mockup.html}"                                  # path to .html
TITLE="${2:-$(basename "$FILE" .html | tr '_' '-')}"
SLUG=$(echo "$TITLE" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -cs 'a-z0-9' '-' \
  | sed 's/^-*//;s/-*$//')

RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST \
  https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "title=$TITLE" \
  -F "slug=$SLUG" \
  -F "file=@$FILE")

handle_response "$RESPONSE"  # see below
```

The file is stored at `index.html` so the URL is just `https://content.thebnut.com/p/<slug>/` (also returned as `.project.url` in the response).

## Upload a folder (zip flow)

```bash
DIR="${1:-.}"
TITLE="${2:-$(basename "$(cd "$DIR" && pwd)")}"
SLUG=$(echo "$TITLE" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -cs 'a-z0-9' '-' \
  | sed 's/^-*//;s/-*$//')

ZIP=$(mktemp -t dump.XXXXXX).zip
( cd "$DIR" && zip -rq "$ZIP" . \
  -x '.DS_Store' '__MACOSX/*' '.git/*' 'node_modules/*' '*.log' )

RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST \
  https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "title=$TITLE" \
  -F "slug=$SLUG" \
  -F "file=@$ZIP")

rm -f "$ZIP"
handle_response "$RESPONSE"
```

## Response handling

```bash
handle_response() {
  local CODE=$(echo "$1" | tail -n1)
  local BODY=$(echo "$1" | sed '$d')
  case "$CODE" in
    201) echo "$BODY" | jq -r '.project.url' ;;
    409) echo "Slug exists. Use the re-upload flow to replace it, or pick a new slug." >&2; exit 2 ;;
    401) echo "Token invalid or revoked. Get a new one at https://dump.thebnut.com/settings" >&2; exit 1 ;;
    413) echo "File is too big (50 MB cap)." >&2; exit 1 ;;
    *)   echo "Error ($CODE): $BODY" >&2; exit 1 ;;
  esac
}
```

Report the URL back to the user. Use the `.project.url` from the response (it lives on `content.thebnut.com`). Keep it terse:

> Published to https://content.thebnut.com/p/marketing-v3/

## Re-upload (wipe + replace an existing project)

If the slug already exists and the user wants to update it, use this endpoint instead. It keeps the project's slug, passwords, and access log; replaces the files. Accepts either a `.zip` or a single `.html`.

```bash
curl -sS -X POST "https://dump.thebnut.com/api/v1/projects/$SLUG/zip" \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "file=@./updated.html"   # or @./updated.zip
```

## Other useful endpoints

```bash
# List your projects
curl -sS https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  | jq '.projects[] | {slug, url, isProtected, accessCount}'

# Add a password (gates the project; multiple labelled passwords supported)
curl -sS -X POST "https://dump.thebnut.com/api/v1/projects/$SLUG/passwords" \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"reviewer","password":"<ask the user>"}'

# Change a password's value (without changing the label)
curl -sS -X PATCH "https://dump.thebnut.com/api/v1/projects/$SLUG/passwords/<id>" \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"<new value>"}'

# Update title/description/entry file
curl -sS -X PATCH "https://dump.thebnut.com/api/v1/projects/$SLUG" \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"New title","entryPath":"home.html"}'

# View access log
curl -sS "https://dump.thebnut.com/api/v1/projects/$SLUG/logs?limit=50" \
  -H "Authorization: Bearer $DUMP_TOKEN" | jq

# Delete (and all hosted files)
curl -sS -X DELETE "https://dump.thebnut.com/api/v1/projects/$SLUG" \
  -H "Authorization: Bearer $DUMP_TOKEN"
```

## Constraints

- **Single-file uploads**: must be `.html` or `.htm`. Other formats need to be in a zip.
- **Zip uploads**: static only — HTML, CSS, JS, images, fonts. No server-side code, no SSR.
- **Caps**: 50 MB total per upload, 200 files max in a zip.
- **Entry file**: `index.html` is the default; if absent, the first `.html` file is used. Override with `-F "entryPath=foo.html"` (zip uploads only — single-html is always stored as `index.html`).
- **Slug uniqueness**: site-wide, not per-user. On collision the API returns `409`. Either pick a new slug or use the `/zip` endpoint to replace.
- **macOS zips**: the API auto-strips `__MACOSX/`, `.DS_Store`, and a single common wrapping folder, so `zip -r foo.zip my-folder` works as expected.
- **Passwords**: stored hashed; plaintext is never retrievable. Rotate by adding a new password and removing the old.
- **Rate limits**: 60 req/min per token, 10 uploads/min.
- **Field name**: the upload field is `file` (the legacy `zip` name is also accepted).

## Auto-expire (TTL)

Projects can carry an optional `expiresAt`. When it passes, the URL returns 410 Gone (immediately) and a cron job hard-deletes the files + frees the slug (next hourly run).

**Default to `expiresIn=7d` for any "throwaway" / "show this to X" / one-shot mockup upload.** Examples that should auto-expire:

- "share this with Martin", "send this to the team for review"
- "throwaway prototype", "quick mockup", "just to look at"
- any AI-generated HTML that wasn't part of an explicit "keep this" workflow

**Don't add expiry when** the user says "publish", "this is the new version", references a specific project they're iterating on, or anything suggesting persistence.

When you set a TTL, **always tell the user**: *"Published to … — auto-expires in 7 days. Use `dump ttl <slug> never` (or the dashboard) to keep it permanently."*

### Setting at upload

Add `-F "expiresIn=7d"` to the create call:

```bash
curl -sS -X POST https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "title=$TITLE" \
  -F "slug=$SLUG" \
  -F "expiresIn=7d" \
  -F "file=@./mockup.html"
```

Accepted: `30s`, `15m`, `6h`, `7d`, up to `365d`. Or `expiresAt=2026-06-01T12:00:00Z` for absolute.

### Changing / clearing later

```bash
# Extend
curl -X PATCH https://dump.thebnut.com/api/v1/projects/$SLUG \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expiresIn":"30d"}'

# Make permanent
curl -X PATCH https://dump.thebnut.com/api/v1/projects/$SLUG \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expiresAt":null}'
```

## Dynamic data via Google Sheets

dump can wire a Google Sheet to a project as a CRUD backend. The SPA
calls `/p/<slug>/sheet/rows` (same-origin) and dump's server proxies
reads + writes to the user's sheet via a service account.

### Trigger this pattern when

The user asks for something like:
- "make a todo list / guestbook / leaderboard / feedback form / mood tracker / etc. that saves"
- "I want this to actually store data"
- "back this with a spreadsheet" / "use a Google Sheet"
- anything where they want CRUD without a real backend

If they want auth, multi-user permissions, or sensitive data, **warn
them**: who can read/write the sheet via the prototype mirrors the
project itself. Public project → public CRUD. Protected project → gate
cookie required. There's no per-user auth.

### What to generate

Just `index.html` — the SPA. No script files, no backend, no copy-pasted
credentials. The SPA hits `/sheet/rows` as a relative URL; dump's
`<base href="/p/<slug>/">` injection resolves it to the right project.

Reference implementation lives at `examples/todo-sheet/` in the dump.thebnut
repo (https://github.com/thebnut/dump.thebnut/tree/main/examples/todo-sheet).
Generate analogous files for whatever the user actually asked for.

### The REST contract

| Browser                          | Returns                              |
| -------------------------------- | ------------------------------------ |
| `GET /sheet/rows`               | `[{id, ...columns}]`                 |
| `POST /sheet/rows`              | `{id, ...columns}` — id auto-set     |
| `PATCH /sheet/rows/<id>`        | `{id, ...columns}`                   |
| `DELETE /sheet/rows/<id>`       | `{deleted: true, id}`                |

All `Content-Type: application/json` — same-origin, no CORS games. The
`id` column is server-managed: created on first write, UUID auto-
generated, immutable on update.

### Setup steps to tell the user

1. **Make a Google Sheet** with columns matching what your SPA expects
   in row 1 (e.g. `id`, `title`, `done` for a todo list). `id` is
   optional — dump adds it on first write and back-fills UUIDs.
2. **Share the sheet** with dump's service account address as **Editor**.
   The address is shown on the project manage page in the "Linked Sheet"
   section. (Hint: `dump-thebnut@dump-thebnut-sheets.iam.gserviceaccount.com`,
   but always copy from the dashboard — env var is the source of truth.)
3. **Link the sheet** on the dump manage page — paste the sheet URL and
   tab name, click [link].

That's it. The SPA picks up the link automatically.

### One-shot script

```bash
# Upload the SPA. No URL to paste — dump's manage page handles linking.
SLUG="${1:-my-prototype}"
TITLE="${2:-$SLUG}"

curl -sS -X POST https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "title=$TITLE" \
  -F "slug=$SLUG" \
  -F "file=@./index.html" | jq -r .project.url
```

Then tell the user (literally, terse — using `project.url` from the response):

> Published to https://content.thebnut.com/p/<slug>/ — the SPA's there
> but it's not wired to a sheet yet. Open the manage page
> (https://dump.thebnut.com/projects/<slug>), share a Google Sheet with
> the displayed service-account address (Editor), paste the sheet URL,
> click [link]. Then the prototype works.

### Linking via API instead of the manage page

For end-to-end automation (e.g. you already have a sheet ID), you can
link without touching the UI:

```bash
curl -sS -X PUT https://dump.thebnut.com/api/v1/projects/$SLUG/sheet \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sheetUrl":"https://docs.google.com/spreadsheets/d/<id>/edit","tabName":"Sheet1"}'
```

Returns 400 with a clear message if the sheet isn't shared with the
service account. The service-account email is in the response of
`GET /api/v1/projects/$SLUG/sheet`.

### Alternative: own your backend (Google Apps Script)

If a user doesn't want to share their sheet with dump's service account
(blast radius concerns, etc.), they can still use a self-hosted Apps
Script. The example folder keeps `apps-script.gs` for this. The SPA
would need to swap `/sheet/rows` for the Apps Script URL and use
`{op}`-style POST bodies instead of REST verbs. Don't suggest this path
unless asked — it's higher friction.

## Important rules

**DO NOT add a password to a project unless the user explicitly asks for one.** If the user does ask, generate or pick the password yourself (don't reuse account passwords) and **echo the value back to the user in plaintext** — they can't recover it from the dashboard. The password endpoint is only for the explicit "make this private" intent.

**Bundler base path warning**: framework builds (Vite, CRA, Next export, etc.) often emit absolute asset paths like `/assets/foo.js`. dump.thebnut server-side rewrites the most common cases (href/src/action/poster/formaction in HTML) to be project-relative, so static prototypes usually Just Work. But **if the user's bundle uses dynamic JS imports** (code-splitting, lazy routes) and the page renders blank, the JS is fetching `/assets/...` from the origin root — which 404s. Tell the user to rebuild with a base path:
- Vite: `vite build --base=./` (or `base: './'` in `vite.config.ts`)
- CRA: set `"homepage": "."` in `package.json` and rebuild
- Next.js (static export): set `basePath` to the project's slug

## Error envelope

All errors return JSON:

```json
{ "error": { "code": "slug_taken", "message": "Slug already taken: foo" } }
```

Codes worth handling: `unauthorized`, `forbidden`, `not_found`, `missing_field`, `slug_taken`, `zip_too_large`, `zip_invalid`, `rate_limited`.

## Full reference

https://dump.thebnut.com/api
