---
name: dump-thebnut
description: Upload static HTML/CSS/JS prototypes to dump.thebnut for hosting and sharing. Use when the user wants to publish a mockup, share a wireframe, "dump" a folder, push a static prototype, or get a shareable URL for HTML they have locally. Requires DUMP_TOKEN env var (get one at https://dump.thebnut.com/settings).
---

# dump.thebnut

Tiny hosted hub for throwaway HTML/CSS/JS prototypes. Upload a folder → get back a stable URL at `https://dump.thebnut.com/p/<slug>/`. Optional per-project password gating; access logs visible in the dashboard.

## When to use this skill

Trigger when the user says any of:
- "dump this", "dump this folder", "dump the site"
- "upload this prototype", "publish this mockup", "share this wireframe"
- "get me a URL for this", "host this"
- references "dump.thebnut" or "dump"

Don't use it for real production deploys (Vercel, Netlify, npm publish, etc.).

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

## Core upload flow

```bash
DIR="${1:-.}"                                              # default: current dir
TITLE="${2:-$(basename "$(cd "$DIR" && pwd)")}"            # default: folder name
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
  -F "zip=@$ZIP")

CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
rm -f "$ZIP"

case "$CODE" in
  201) echo "$BODY" | jq -r '.project.url' ;;
  409) echo "Slug '$SLUG' is taken. Use the re-upload flow below to replace it, or pick a new slug." >&2; exit 2 ;;
  401) echo "Token invalid or revoked. Get a new one at https://dump.thebnut.com/settings" >&2; exit 1 ;;
  413) echo "Zip is too big (50 MB / 200 file cap)." >&2; exit 1 ;;
  *)   echo "Error ($CODE): $BODY" >&2; exit 1 ;;
esac
```

Report the URL back to the user. Keep it terse:

> Published to https://dump.thebnut.com/p/marketing-v3/

## Re-upload (wipe + replace an existing project)

If the slug already exists and the user wants to update it, use this endpoint instead. It keeps the project's slug, passwords, and access log; replaces the files.

```bash
curl -sS -X POST "https://dump.thebnut.com/api/v1/projects/$SLUG/zip" \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "zip=@$ZIP"
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

- **Static only**: HTML, CSS, JS, images, fonts. No server-side code, no SSR, no Node runtime.
- **Caps**: 50 MB total per zip, 200 files max.
- **Entry file**: `index.html` is the default entry; if absent, the first `.html` file is used. Override with `-F "entryPath=foo.html"` on upload.
- **Slug uniqueness**: site-wide, not per-user. On collision the API returns `409`. Either pick a new slug or use the `/zip` endpoint to replace.
- **macOS zips**: the API auto-strips `__MACOSX/`, `.DS_Store`, and a single common wrapping folder, so `zip -r foo.zip my-folder` works as expected.
- **Passwords**: stored hashed; plaintext is never retrievable. Rotate by adding a new password and removing the old.
- **Rate limits**: 60 req/min per token, 10 uploads/min.

## Error envelope

All errors return JSON:

```json
{ "error": { "code": "slug_taken", "message": "Slug already taken: foo" } }
```

Codes worth handling: `unauthorized`, `forbidden`, `not_found`, `missing_field`, `slug_taken`, `zip_too_large`, `zip_invalid`, `rate_limited`.

## Full reference

https://dump.thebnut.com/api
