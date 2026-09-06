import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
async function main() {
  if (!process.argv[2]) throw new Error("Pass the protected environment-file path");
  config({ path: process.argv[2], quiet: true });
  const sql = postgres(process.env.POSTGRES_URL || process.env.DATABASE_URL || "", { max: 1, prepare: false });
  try {
    const token = readFileSync(`${homedir()}/.config/dump-thebnut/token`, "utf8").trim();
    const hash = createHash("sha256").update(token).digest("hex");
    const [owner] = await sql`select user_id from api_tokens where token_hash = ${hash} and revoked_at is null limit 1`;
    if (!owner) throw new Error("The existing publisher credential has no active owner");
    // Vercel preserves stdin verbatim. A trailing newline breaks the exact owner check.
    const result = spawnSync("vercel", ["env", "add", "TOOLKIT_OWNER_ID", "production", "--scope", "team_Ho8iFbFMhpxq9SuxTNgCqvYw"], { input: owner.user_id, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Owner environment setting could not be added");
    console.log("Toolkit access is configured for the owner of the existing publisher credential");
  } finally { await sql.end(); }
}
main().catch(() => { console.error("Owner configuration stopped; inspect before retrying"); process.exitCode = 1; });
