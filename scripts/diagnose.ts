// Usage: npm run diag -- <slug>
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/diagnose.ts <slug>");
    process.exit(1);
  }
  const { db } = await import("../src/lib/db");
  const { projects, projectFiles } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const [p] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!p) {
    console.log(`No project with slug '${slug}'`);
    process.exit(0);
  }
  console.log({ id: p.id, slug: p.slug, entry: p.entryPath, blobPrefix: p.blobPrefix });

  const files = await db
    .select({
      path: projectFiles.path,
      contentType: projectFiles.contentType,
      size: projectFiles.size,
    })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, p.id));

  console.log(`\n${files.length} file(s):`);
  for (const f of files) {
    console.log(`  ${f.path}  (${f.contentType}, ${f.size}B)`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
