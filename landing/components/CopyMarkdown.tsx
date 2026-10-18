//created by kinjal
"use client";

import { useState } from "react";

export function CopyMarkdown({ text, label = "Copy markdown", tone = "light" }: { text: string; label?: string; tone?: "light" | "blue" }) {
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
    <button
      type="button"
      onClick={onCopy}
      className={
        tone === "blue"
          ? "rounded-full bg-white px-6 py-3 text-base font-medium text-[#1426e6] transition hover:bg-[#f2f0ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          : "rounded-full border border-[#1426e6]/25 px-4 py-2 text-[0.95rem] text-[#1426e6] transition hover:border-[#1426e6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1426e6]"
      }
    >
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
