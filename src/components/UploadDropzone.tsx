"use client";

import { useRef, useState } from "react";

type Props = {
  name: string;
  required?: boolean;
};

const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXTS = [".zip", ".html", ".htm"] as const;

function extOk(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

export function UploadDropzone({ name, required }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(picked: File | null) {
    if (!picked) {
      setFile(null);
      setError(null);
      return;
    }
    if (!extOk(picked.name)) {
      setError("must be a .zip or .html file");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError(
        `file is too big (${(picked.size / 1024 / 1024).toFixed(1)} MB > 50 MB)`,
      );
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(picked);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setHover(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    accept(dropped);
    if (inputRef.current && extOk(dropped.name) && dropped.size <= MAX_BYTES) {
      const dt = new DataTransfer();
      dt.items.add(dropped);
      inputRef.current.files = dt.files;
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    accept(e.target.files?.[0] ?? null);
  }

  function clear(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function fmtSize(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-2">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-neutral-950/60 px-6 py-10 cursor-pointer transition-colors ${
          hover
            ? "border-[#39ff88] bg-[rgba(57,255,136,0.05)] shadow-[0_0_24px_-6px_rgba(57,255,136,0.55)]"
            : "border-neutral-700 hover:bg-neutral-900/40"
        }`}
      >
        {file ? (
          <>
            <p className="text-sm text-neutral-100">
              <span className="text-[#39ff88]">●</span> {file.name}
            </p>
            <p className="text-xs text-neutral-500">{fmtSize(file.size)}</p>
            <button
              type="button"
              onClick={clear}
              className="mt-1 text-xs text-neutral-500 hover:text-red-300"
            >
              [remove]
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-300">
              <span className="text-neutral-600">$ </span>drop a .zip or .html
              here
            </p>
            <p className="text-xs text-neutral-500">
              <span className="text-neutral-600">// </span>or click to choose
            </p>
          </>
        )}
        <input
          ref={inputRef}
          name={name}
          type="file"
          accept=".zip,.html,.htm,application/zip,text/html"
          required={required}
          onChange={onPick}
          className="sr-only"
          tabIndex={-1}
        />
      </div>
      {error ? <p className="text-xs text-red-400">! {error}</p> : null}
    </div>
  );
}
