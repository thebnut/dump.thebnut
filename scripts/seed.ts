// Bootstrap a single admin user from env vars if none exists.
// Safe to run repeatedly — no-ops if any user exists.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping.");
    return;
  }

  const bcrypt = (await import("bcryptjs")).default;
  const { db } = await import("../src/lib/db");
  const { users } = await import("../src/lib/db/schema");

  const existing = await db.select().from(users).limit(1);
  if (existing[0]) {
    console.log("Users already exist — skipping seed.");
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash: hash, role: "admin" });
  console.log(`Seeded admin user ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
