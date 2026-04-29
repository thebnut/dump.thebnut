import "server-only";
import { eq, desc, sql, and } from "drizzle-orm";
import { db } from "./db";
import {
  projects,
  accessLogs,
  projectPasswords,
  projectFiles,
  users,
} from "./db/schema";

export type ProjectWithStats = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  entryPath: string;
  isProtected: boolean;
  createdAt: Date;
  updatedAt: Date;
  ownerEmail: string;
  accessCount: number;
};

export async function projectsForOwner(
  ownerId: string,
): Promise<ProjectWithStats[]> {
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      title: projects.title,
      description: projects.description,
      entryPath: projects.entryPath,
      isProtected: projects.isProtected,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerEmail: users.email,
      accessCount: sql<number>`coalesce(count(${accessLogs.id}), 0)::int`,
    })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(accessLogs, eq(accessLogs.projectId, projects.id))
    .where(eq(projects.ownerId, ownerId))
    .groupBy(projects.id, users.email)
    .orderBy(desc(projects.updatedAt));
  return rows.map((r) => ({ ...r, ownerEmail: r.ownerEmail ?? "—" }));
}

export async function allProjectsAdmin(): Promise<ProjectWithStats[]> {
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      title: projects.title,
      description: projects.description,
      entryPath: projects.entryPath,
      isProtected: projects.isProtected,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerEmail: users.email,
      accessCount: sql<number>`coalesce(count(${accessLogs.id}), 0)::int`,
    })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(accessLogs, eq(accessLogs.projectId, projects.id))
    .groupBy(projects.id, users.email)
    .orderBy(desc(projects.updatedAt));
  return rows.map((r) => ({ ...r, ownerEmail: r.ownerEmail ?? "—" }));
}

export async function projectBySlugForUser(
  slug: string,
  ownerId: string,
  isAdmin: boolean,
) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  const project = rows[0];
  if (!project) return null;
  if (!isAdmin && project.ownerId !== ownerId) return null;
  return project;
}

export async function logsForProject(projectId: string, limit = 200) {
  return db
    .select()
    .from(accessLogs)
    .where(eq(accessLogs.projectId, projectId))
    .orderBy(desc(accessLogs.ts))
    .limit(limit);
}

export async function passwordsForProject(projectId: string) {
  return db
    .select({
      id: projectPasswords.id,
      label: projectPasswords.label,
      createdAt: projectPasswords.createdAt,
    })
    .from(projectPasswords)
    .where(eq(projectPasswords.projectId, projectId));
}

export async function projectBySlugPublic(slug: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function passwordsForProjectFull(projectId: string) {
  return db
    .select()
    .from(projectPasswords)
    .where(eq(projectPasswords.projectId, projectId));
}

export async function listUsers() {
  return db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      projectCount: sql<number>`coalesce(count(${projects.id}), 0)::int`,
    })
    .from(users)
    .leftJoin(projects, eq(projects.ownerId, users.id))
    .groupBy(users.id)
    .orderBy(users.createdAt);
}

export async function findProjectFile(projectId: string, path: string) {
  const rows = await db
    .select()
    .from(projectFiles)
    .where(
      and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)),
    )
    .limit(1);
  return rows[0] ?? null;
}
