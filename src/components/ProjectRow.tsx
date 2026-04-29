import Link from "next/link";
import type { ProjectWithStats } from "@/lib/queries";

export function ProjectRow({ project }: { project: ProjectWithStats }) {
  return (
    <div className="group relative flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-[rgba(57,255,136,0.025)] transition-colors">
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[2px] bg-transparent group-hover:bg-[#39ff88] group-hover:shadow-[0_0_8px_rgba(57,255,136,0.5)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-neutral-600 text-xs">&gt;</span>
          <Link
            href={`/projects/${project.slug}`}
            className="font-medium text-sm text-neutral-100 truncate min-w-0 group-hover:underline group-hover:decoration-[#39ff88] underline-offset-[3px]"
          >
            {project.title}
          </Link>
          {project.isProtected ? (
            <span className="rounded bg-amber-900/40 text-amber-200 text-[10px] px-1.5 py-0.5 uppercase tracking-wide whitespace-nowrap">
              protected
            </span>
          ) : (
            <span className="rounded bg-emerald-900/40 text-emerald-200 text-[10px] px-1.5 py-0.5 uppercase tracking-wide whitespace-nowrap">
              public
            </span>
          )}
        </div>
        {project.description ? (
          <p className="text-[13px] text-neutral-400 truncate ml-[22px] mt-1">
            <span className="text-neutral-600">{"// "}</span>
            {project.description}
          </p>
        ) : null}
        <p className="text-xs text-neutral-600 truncate ml-[22px] mt-1">
          /p/{project.slug}/ · {project.entryPath}
        </p>
      </div>

      <div className="flex items-center gap-3.5 shrink-0">
        <span className="tabular-nums text-neutral-300">
          <span className="text-base">{project.accessCount}</span>
          <span className="ml-1 text-neutral-600 text-xs">hits</span>
        </span>
        <Link
          href={`/projects/${project.slug}`}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800 whitespace-nowrap"
        >
          [manage]
        </Link>
      </div>
    </div>
  );
}
