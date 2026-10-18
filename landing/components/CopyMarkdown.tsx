"use client";

import { useState } from "react";

export function CopyMarkdown({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 2000);
  }
  return (
    <button type="button" onClick={onCopy} className="rounded-full border border-[#1426e6]/25 px-4 py-2 text-[0.95rem] text-[#1426e6] transition hover:border-[#1426e6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1426e6]">
      <span aria-live="polite">{done ? "Copied" : "Copy markdown"}</span>
    </button>
  );
}
