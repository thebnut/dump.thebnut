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
