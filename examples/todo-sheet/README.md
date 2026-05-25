# todo-sheet — a sheet-backed prototype

A self-contained SPA that uses a Google Sheet as its database. Hosted as a
normal static prototype on dump.thebnut; CRUD goes through dump's
server-side proxy to the sheet — no client-side Google credentials, no
Apps Script for the user to deploy.

```
[browser]  ──fetch──▶  [dump.thebnut /sheet/]  ──Sheets API──▶  [Google Sheet]
   ▲                          (server-side proxy,                   (your data)
   │                           single service account)
served as a regular
dump.thebnut prototype
```

## What you need

- A Google account.
- A `DUMP_TOKEN` from https://dump.thebnut.com/settings.

## Setup (~90 seconds the first time)

### 1. Create the sheet

Make a new Google Sheet. Row 1 is treated as column headers. For this
example, add:

| id | title | done |
| -- | ----- | ---- |

You can leave `id` blank — the proxy will populate it. Or skip the `id`
column entirely; the proxy auto-adds it on first write and back-fills
UUIDs for any existing rows.

### 2. Upload this prototype to dump

```bash
cd examples/todo-sheet
curl -sS -X POST https://dump.thebnut.com/api/v1/projects \
  -H "Authorization: Bearer $DUMP_TOKEN" \
  -F "title=todos" \
  -F "slug=todos" \
  -F "file=@./index.html"
```

You'll get back a URL like `https://dump.thebnut.com/p/todos/`. Opening
it now will show a *"not configured"* warning — you haven't linked a
sheet yet.

### 3. Link the sheet on the manage page

Open the project's manage page in your dashboard (or
`https://dump.thebnut.com/projects/todos`).

You'll see a **Linked Sheet** section showing dump's service-account
address (something like
`dump-thebnut@dump-thebnut-sheets.iam.gserviceaccount.com`). Copy it.

Open your Google Sheet, click **Share**, paste that address as an
**Editor**, click **Send** (uncheck "Notify people" — it's a robot).

Back on dump's manage page: paste the sheet's URL into the field,
optionally change the tab name from `Sheet1`, click **[link]**.

That's it.

### 4. Try it

Open `https://dump.thebnut.com/p/todos/`. Add a few items, refresh,
they're still there. Open the Google Sheet in another tab — rows
appear with auto-generated UUIDs in column A.

## How it works

The SPA makes plain REST calls to `/sheet/rows` (relative URL — dump
injects `<base href="/p/<slug>/">` server-side so it resolves to
`/p/<slug>/sheet/rows`):

| Browser                          | Server returns                       |
| -------------------------------- | ------------------------------------ |
| `GET /sheet/rows`               | `[{id, ...columns}]`                 |
| `POST /sheet/rows`              | `{id, ...columns}` — id auto-set     |
| `PATCH /sheet/rows/<id>`        | `{id, ...columns}`                   |
| `DELETE /sheet/rows/<id>`       | `{deleted: true, id}`                |

dump's route handler authenticates to the Sheets API via a signed JWT
(service account), reads the sheet ID from the `project_sheets` table,
performs the CRUD, returns JSON.

The `id` column is server-managed: created on first write, UUID
auto-generated, immutable on update. Reordering or hand-editing rows
in the sheet is fine — the SPA still finds them by id.

## Customising this for your own prototype

This is a generic CRUD pattern. To re-use for something else (a
guestbook, a feedback form, a leaderboard, a meal planner…):

1. Make a new sheet with whatever columns you want — first row is the schema.
2. Upload your SPA to dump and link the sheet via the manage page.
3. In your SPA's JS, call `fetch("sheet/rows")` etc. with the column
   names you defined.
4. Render however suits your UI.

dump doesn't care what your columns are called — it just keeps the
first row as headers and the rest as records.

## Caveats / limits

- **Throughput**: Google Sheets API allows 60 read/100s and 60 write/100s
  per service-account project. Fine for personal/team prototypes; if
  you're popular enough to hit this, you've outgrown the pattern.
- **Concurrency**: last-write wins on same-row updates. Sheets has no
  native row versioning. Two concurrent deletes can't shift rows out
  from under each other — dump's proxy uses `findRowIndex` immediately
  before the delete, but there's still a small window. Acceptable for
  prototypes.
- **Auth**: who can read and write the sheet via your prototype mirrors
  the project itself. If the dump project is public, the linked sheet
  is publicly mutable via that URL. If you password-protect the project,
  the gate cookie is required for `/sheet/*` calls too.
- **Formula injection — handled**: dump auto-escapes any string value
  beginning with `=`, `+`, `-`, or `@` (prefixes with `'` apostrophe).
  Without this, anyone with the prototype's URL could POST
  `{title: "=IMPORTXML(...)"}` and Sheets would fire the formula.
- **Sheet edits by hand are fine** — but if you rename a column header,
  the SPA needs to be updated to match.

## Troubleshooting

**"not configured" appears in the page.** No sheet linked to this
project. Open the manage page (`/projects/<slug>`) and follow step 3.

**"sheet not accessible" when linking.** You didn't share the sheet
with the service-account email shown on the manage page. Click
**Share** in the sheet → paste the address → Editor → Send.

**Updates don't appear in the sheet.** Either the link to the sheet is
stale (the sheet was deleted or moved) or the service account has lost
Editor access. Re-link from the manage page.

**429 / rate limited.** Sheets API quota. Wait a minute. If this happens
in normal use, you may be polling too aggressively — this example
fetches on page load only.

## Alternative: own your backend (Google Apps Script)

If you'd rather not give dump's service account access to your sheet,
you can run your own backend via a Google Apps Script Web App. Earlier
revisions of this example used that pattern — the building blocks are
still in [`apps-script.gs`](./apps-script.gs) in this directory.

You'd replace `SHEET_API = "sheet/rows"` in `index.html` with your
Apps Script URL and change the four `apiList`/`apiCreate`/`apiUpdate`/
`apiDelete` functions to POST `{op}`-style bodies instead of using
PATCH/DELETE — see the `doPost` switch in `apps-script.gs` for the
contract.
