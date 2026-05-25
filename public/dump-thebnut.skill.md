---
name: dump-thebnut
description: Upload static HTML/CSS/JS prototypes to dump.thebnut for hosting and sharing. Use when the user wants to publish a mockup, share a wireframe, "dump" a folder, push a static prototype, host an AI-generated HTML file, or get a shareable URL for HTML they have locally. Accepts a folder (zips it) or a single .html file. Requires DUMP_TOKEN env var (get one at https://dump.thebnut.com/settings).
---

# dump.thebnut

Tiny hosted hub for throwaway HTML/CSS/JS prototypes. Upload a folder OR a single HTML file → get back a stable URL at `https://dump.thebnut.com/p/<slug>/`. Optional per-project password gating; access logs visible in the dashboard.

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

## Pick a path: single file or folder?

**Single .html / .htm file** — common for AI-generated mockups, self-contained pages with inline CSS/JS. Skip the zip step entirely.

**Folder of static assets** — multi-file prototypes with separate CSS/JS/images. Zip first.

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

The file is stored at `index.html` so the URL is just `https://dump.thebnut.com/p/<slug>/`.

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

Report the URL back to the user. Keep it terse:

> Published to https://dump.thebnut.com/p/marketing-v3/

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

dump only serves static files, but a static SPA can talk to any HTTPS
endpoint. The supported pattern for "dynamic" prototypes is a Google
Apps Script Web App wrapping a Google Sheet — the user gets a tiny
CRUD JSON API with zero infrastructure, owned entirely by their Google
account.

### Trigger this pattern when

The user asks for something like:
- "make a todo list / guestbook / leaderboard / feedback form / mood tracker / etc. that saves"
- "I want this to actually store data"
- "back this with a spreadsheet" / "use a Google Sheet"
- anything where they want CRUD without a real backend

If they want auth, multi-user permissions, or sensitive data, **stop and
warn them** — the Apps Script Web App deployment is anonymous (anyone
with the URL can read and mutate the sheet). For those cases, recommend
they raise it with Brett directly; dump doesn't currently have a
first-class auth-aware data layer.

### What to generate

Two files in the prototype folder, plus instructions for the user:

1. **`index.html`** — the SPA. Has a `SHEET_API` constant near the top
   that the user replaces with their deployed Apps Script URL.

2. **`apps-script.gs`** — Apps Script template. The user pastes this into
   the script editor bound to their sheet.

Reference implementations live at `examples/todo-sheet/` in the dump.thebnut
repo (https://github.com/thebnut/dump.thebnut/tree/main/examples/todo-sheet).
Generate analogous files for whatever the user actually asked for; keep
the contract identical so the same script template works.

### The contract (don't deviate without reason)

| Browser sends                                            | Script returns                                |
| -------------------------------------------------------- | --------------------------------------------- |
| `GET <SHEET_API>`                                        | `[{id, ...columns}]` — all rows               |
| `POST` body `{"op":"create","row":{...}}`                | `{id, ...columns}` — the new row             |
| `POST` body `{"op":"update","id":"...","row":{...}}`     | `{id, ...columns}` — the updated row         |
| `POST` body `{"op":"delete","id":"..."}`                 | `{deleted: true, id}`                        |

All POSTs use `Content-Type: text/plain;charset=utf-8` (NOT `application/json`)
to keep the browser in "simple request" mode — Apps Script Web Apps don't
handle CORS preflight reliably. The body is JSON-stringified anyway.

The `id` column is auto-managed: the script adds it if missing, generates
UUIDs on create, treats it as immutable on update. The first row of the
sheet is the schema; the SPA can use any column names.

### Setup steps to tell the user

After uploading the SPA to dump:

1. Make a Google Sheet with columns matching what your SPA expects in
   row 1 (e.g. `id`, `title`, `done` for a todo list). `id` is optional —
   the script adds it on first use.
2. **Extensions → Apps Script** in the sheet, paste `apps-script.gs`, save.
3. **Deploy → New deployment → Web app**: execute as Me, access Anyone,
   click Deploy, authorize, copy the URL.
4. Paste that URL into `index.html` as `SHEET_API`.
5. Re-upload the prototype to dump (use the `/zip` re-upload endpoint).

### One-shot script

```bash
# After generating ./index.html and ./apps-script.gs in the project folder:
SLUG="${1:-my-prototype}"
TITLE="${2:-$SLUG}"

# Upload the SPA only — the Apps Script lives in Google, not in dump.
curl -sS -X POST https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "title=$TITLE" \
  -F "slug=$SLUG" \
  -F "file=@./index.html"
```

Then tell the user (literally, terse):

> Published to https://dump.thebnut.com/p/<slug>/ — but it's not wired up
> to a sheet yet. Open the URL and you'll see a "not configured" warning.
> Run through the 5 steps in apps-script.gs (top of the file) to deploy
> the backend, paste the URL into index.html, and re-upload.

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
