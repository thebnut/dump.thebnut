import Link from "next/link";
import type { ProjectWithStats } from "@/lib/queries";

export function ProjectRow({ project }: { project: ProjectWithStats }) {
  return (
    <li className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/p/${project.slug}/`}
            target="_blank"
            className="font-medium hover:underline truncate"
          >
            {project.title}
          </Link>
          {project.isProtected ? (
            <span className="rounded-md bg-amber-900/40 text-amber-200 text-[10px] px-1.5 py-0.5 uppercase tracking-wide">
              Protected
            </span>
          ) : (
            <span className="rounded-md bg-emerald-900/40 text-emerald-200 text-[10px] px-1.5 py-0.5 uppercase tracking-wide">
              Public link
            </span>
          )}
        </div>
        {project.description ? (
          <p className="text-sm text-neutral-400 truncate">
            {project.description}
          </p>
        ) : null}
        <p className="text-xs text-neutral-500 font-mono mt-1 truncate">
          /p/{project.slug}/ · {project.entryPath}
        </p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Link
          href={`/projects/${project.slug}`}
          className="text-sm text-neutral-300 hover:text-white"
          title="View access log"
        >
          <span className="font-mono tabular-nums text-base">
            {project.accessCount}
          </span>
          <span className="ml-1 text-neutral-500">hits</span>
        </Link>
        <Link
          href={`/projects/${project.slug}`}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800"
        >
          Manage
        </Link>
      </div>
    </li>
  );
}
