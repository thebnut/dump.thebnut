// Usage: npm run user -- <email> <password> [admin|user]
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { users } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

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
