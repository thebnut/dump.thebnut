import Link from "next/link";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { mark: number; text: string }> = {
  sm: { mark: 18, text: "text-sm" },
  md: { mark: 24, text: "text-base" },
  lg: { mark: 28, text: "text-lg" },
};

export function Logo({
  size = "md",
  href,
}: {
  size?: Size;
  href?: string;
}) {
  const s = SIZES[size];
  const inner = (
    <span className="inline-flex items-center gap-2.5 leading-none">
      <svg
        width={s.mark}
        height={s.mark}
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="shrink-0"
        style={{ filter: "drop-shadow(0 0 4px rgba(57,255,136,0.55))" }}
      >
        <path
          d="M 22 16 L 14 16 L 14 48 L 22 48"
          fill="none"
          stroke="#39ff88"
          strokeWidth="3"
          strokeLinecap="square"
        />
        <path
          d="M 42 16 L 50 16 L 50 48 L 42 48"
          fill="none"
          stroke="#39ff88"
          strokeWidth="3"
          strokeLinecap="square"
        />
        <rect x="29" y="30" width="6" height="6" fill="#5fff9f" />
      </svg>
      <span
        className={`${s.text} font-mono font-semibold tracking-tight text-neutral-100`}
      >
        .thebnut
      </span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} aria-label="dump.thebnut">
        {inner}
      </Link>
    );
  }
  return <span aria-label="dump.thebnut">{inner}</span>;
}
