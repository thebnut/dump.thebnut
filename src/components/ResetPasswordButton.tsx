"use client";

import { useActionState, useState } from "react";

// Shared between the client island and the `resetUserPassword` server action
// in admin/page.tsx. `password` is only ever populated on success, and lives
// solely in this component's state — it never touches the URL.
export type ResetState = {
  ok: boolean;
  email?: string;
  password?: string;
  error?: string;
};

type Props = {
  userId: string;
  email: string;
  action: (prev: ResetState, formData: FormData) => Promise<ResetState>;
};

const INITIAL: ResetState = { ok: false };

export function ResetPasswordButton({ userId, email, action }: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!state.password) return;
    try {
      await navigator.clipboard.writeText(state.password);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (no focus / insecure context). The password
      // is still visible on screen for manual copy, so fail quietly.
    }
  }

  if (state.ok && state.password) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <code className="rounded bg-neutral-800 px-2 py-1 text-[#39ff88] select-all">
          {state.password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-[#39ff88] hover:text-[#39ff88] transition-colors"
        >
          {copied ? "copied" : "copy"}
        </button>
        <span className="text-neutral-600">shown once</span>
      </span>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (
            !window.confirm(
              `Reset password for ${email}? Their current password stops working immediately.`,
            )
          ) {
            e.preventDefault();
          }
        }}
        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:border-[#39ff88] hover:text-[#39ff88] transition-colors disabled:opacity-50"
      >
        {pending ? "…" : "[reset pw]"}
      </button>
      {state.error ? (
        <span className="text-xs text-red-400">! {state.error}</span>
      ) : null}
    </form>
  );
}
