import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.POSTGRES_URL || process.env.DATABASE_URL || "";

if (!connectionString && process.env.NODE_ENV !== "test") {
  console.warn(
    "POSTGRES_URL is not set — DB calls will fail until you configure the env var.",
  );
}

const client = postgres(connectionString, {
  prepare: false,
  max: 1,
});

export const db = drizzle(client, { schema });
export { schema };
