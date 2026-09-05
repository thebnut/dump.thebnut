import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "node:fs";

async function main() {
  if (!process.argv[2]) throw new Error("Pass the protected environment-file path");
  config({ path: process.argv[2], quiet: true });
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Database connection is missing");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const [state] = await sql`select to_regclass('public.oauth_codes')::text as codes, to_regclass('public.oauth_tokens')::text as tokens, to_regclass('drizzle.__drizzle_migrations')::text as migrations`;
    const ledger = state.migrations ? await sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1` : [];
    console.log(JSON.stringify({ existingOAuthSchema: !!state.codes && !!state.tokens, latestMigrationTimestamp: ledger[0]?.created_at, mode: process.argv.includes('--apply') ? 'apply' : 'inspect' }));
    if (process.argv.includes('--apply')) {
      if (state.codes || state.tokens) throw new Error("OAuth tables already exist; inspect rather than reapply");
      // Existing production predates a populated Drizzle ledger. Apply only
      // this additive migration; do not replay or forge historical entries.
      const migration = readFileSync("drizzle/0005_cheerful_aqueduct.sql", "utf8");
      await sql.begin(async tx => {
        for (const statement of migration.split("--> statement-breakpoint")) {
          if (statement.trim()) await tx.unsafe(statement);
        }
      });
      console.log("OAuth schema migration applied");
    }
  } finally { await sql.end(); }
}
main().catch(() => { console.error("Migration stopped; inspect the environment or ledger before retrying"); process.exitCode = 1; });
