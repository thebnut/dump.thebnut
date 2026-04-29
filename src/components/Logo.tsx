import Link from "next/link";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { mark: number; text: string }> = {
  sm: { mark: 18, text: "text-sm" },
  md: { mark: 22, text: "text-base" },
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
    <span className="inline-flex items-center gap-2 leading-none">
      <svg
        width={s.mark}
        height={s.mark}
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="text-neutral-100 shrink-0"
      >
        <path
          d="M 22 16 L 14 16 L 14 48 L 22 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="square"
        />
        <path
          d="M 42 16 L 50 16 L 50 48 L 42 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="square"
        />
        <rect x="29" y="30" width="6" height="6" fill="#34d399" />
      </svg>
      <span
        className={`${s.text} font-mono font-semibold tracking-tight`}
      >
        <span className="text-neutral-400">dump</span>
        <span className="text-neutral-100">.thebnut</span>
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
