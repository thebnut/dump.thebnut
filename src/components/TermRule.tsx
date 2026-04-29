export function TermRule({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "danger";
}) {
  const color = tone === "danger" ? "text-red-300" : "text-neutral-500";
  return (
    <div
      className={`flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.12em] ${color}`}
    >
      <span aria-hidden="true">──</span>
      <span>{label}</span>
      <span
        aria-hidden="true"
        className="flex-1 border-t border-dashed border-neutral-800"
      />
    </div>
  );
}

export function Cursor() {
  return <span aria-hidden="true" className="dump-cursor" />;
}
