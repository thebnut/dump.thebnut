import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    entryPath: text("entry_path").notNull().default("index.html"),
    isProtected: boolean("is_protected").notNull().default(false),
    blobPrefix: text("blob_prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("projects_slug_idx").on(t.slug),
    index("projects_owner_idx").on(t.ownerId),
  ],
);

export const projectPasswords = pgTable(
  "project_passwords",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("project_passwords_project_idx").on(t.projectId)],
);

export const accessLogs = pgTable(
  "access_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    path: text("path"),
    passwordLabelUsed: text("password_label_used"),
    passwordLabelId: uuid("password_label_id").references(
      () => projectPasswords.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [index("access_logs_project_idx").on(t.projectId, t.ts)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_idx").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
  },
  (t) => [
    uniqueIndex("project_files_unique").on(t.projectId, t.path),
    index("project_files_project_idx").on(t.projectId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  passwords: many(projectPasswords),
  logs: many(accessLogs),
  files: many(projectFiles),
}));

export const projectPasswordsRelations = relations(
  projectPasswords,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectPasswords.projectId],
      references: [projects.id],
    }),
  }),
);

export const accessLogsRelations = relations(accessLogs, ({ one }) => ({
  project: one(projects, {
    fields: [accessLogs.projectId],
    references: [projects.id],
  }),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectPassword = typeof projectPasswords.$inferSelect;
export type AccessLog = typeof accessLogs.$inferSelect;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
