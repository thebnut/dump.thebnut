# Private Brett Toolkit service

This branch adds a private, remote MCP connection to dump.thebnut. Its five workflow definitions are in `src/lib/toolkit-workflows.json`. Do not push those personal instructions to the public repository without an explicit publishing decision.

The running service depends on the existing Vercel/Postgres/Blob configuration and `TOOLKIT_OWNER_ID`, the user ID belonging to Brett's existing publisher account. Only that account can authorize the Toolkit or use its OAuth tokens. The separate Outline and Limitless connections keep their native authentication; no credentials for them are stored here.

- MCP: `/mcp`
- OAuth discovery: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
- User consent: `/oauth/authorize`
- User revocation: `/oauth/connections`
- Public client: `chatgpt`, S256 PKCE, no secret
- Callback: `https://chatgpt.com/connector_platform_oauth_redirect`; authorization responses include the pinned issuer

Run `npm ci`, `npm test` and `npm run build`. The tests use PGlite and simulated Blob storage; they do not touch production projects or credentials. Automatic password-wallet matching is a bounded convenience. The explicit gate remains the fallback and checks all current password labels.

For a new database, use the normal ordered Drizzle migrations. The existing production database has an empty historical migration ledger. `scripts/migrate-toolkit.ts <protected-env-file> --apply` applies ONLY the additive OAuth migration to that legacy database, refusing when the tables already exist. It does not manufacture history or replay old table creation. Do not replace it with `db:push` against production.

`scripts/configure-toolkit-owner.ts <protected-env-file>` derives the owner from the existing protected publisher credential and adds the production Vercel setting. It prints neither the credential nor the environment values. Use only for the already-linked project, and inspect before retrying an existing setting.

Before a subsequent deployment, inspect the production deployment and compare its source with this branch. The original Mac checkout was behind the deployed code at the start of this work. Deploy a candidate with `vercel deploy --prod --skip-domain`, verify it with `vercel curl`, then promote that exact candidate. Keep the preceding production deployment as the rollback target. Do not disable deployment protection.

To update workflows, edit the portable plugin source and use `portable/sync_workflows.py` from the parent toolkit workspace to regenerate the JSON. Verify that packaged and hosted instructions match, run tests, and redeploy. Changing a local file does not update an already deployed server.
