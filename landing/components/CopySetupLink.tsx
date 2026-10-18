"use client";

import { useState } from "react";

// A quiet text link that copies the agent setup prompt: "Already using an agent? Copy setup prompt".
export function CopySetupLink({ prompt, ask, copy, copied }: { prompt: string; ask: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 2200);
  }

  return (
    <p className="mt-7 text-base text-[#f2f0ff]/90">
      {ask}{" "}
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-2 font-medium text-white underline decoration-white/40 underline-offset-4 transition hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        <span aria-live="polite">{done ? copied : copy}</span>
        <span aria-hidden>&#x2197;</span>
      </button>
    </p>
  );
}
