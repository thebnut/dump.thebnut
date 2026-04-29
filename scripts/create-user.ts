// Usage: npm run user -- <email> <password> [admin|user]
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const [email, password, role = "user"] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npm run user -- <email> <password> [admin|user]");
    process.exit(1);
  }
  if (role !== "admin" && role !== "user") {
    console.error("Role must be 'admin' or 'user'");
    process.exit(1);
  }

  // Dynamic imports so env is loaded before the db client is constructed.
  const bcrypt = (await import("bcryptjs")).default;
  const { db } = await import("../src/lib/db");
  const { users } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const hash = await bcrypt.hash(password, 10);
  const lower = email.toLowerCase();

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, lower))
    .limit(1);

  if (existing[0]) {
    await db
      .update(users)
      .set({ passwordHash: hash, role })
      .where(eq(users.email, lower));
    console.log(`Updated user ${lower} (role=${role})`);
  } else {
    await db
      .insert(users)
      .values({ email: lower, passwordHash: hash, role });
    console.log(`Created user ${lower} (role=${role})`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
