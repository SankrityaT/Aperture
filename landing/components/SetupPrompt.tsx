"use client";

import { useState } from "react";

// "Already using an agent? Copy setup prompt", with the prompt itself one click away so nothing is hidden.
export function SetupPrompt({ prompt, ask, copy, copied, peek }: { prompt: string; ask: string; copy: string; copied: string; peek: string }) {
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
    <div className="mx-auto w-full max-w-[760px]">
      <div className="flex flex-col items-stretch gap-3 rounded-3xl border border-[#1426e6]/25 bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:py-2 sm:pl-6 sm:pr-2">
        <span className="px-2 text-center text-lg text-[#0b1240] sm:px-0 sm:text-left">{ask}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1426e6] px-5 py-3 sm:py-2.5 text-base font-medium text-white transition hover:bg-[#0f1fc4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1426e6]"
        >
          <span aria-hidden className="relative h-4 w-4">
            <span className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-[3px] border border-white/60" />
            <span className="absolute inset-0 rounded-[3px] border border-white" />
          </span>
          <span aria-live="polite">{done ? copied : copy}</span>
        </button>
      </div>
      <details className="group mt-4 text-center">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-base text-[#5c6288] transition hover:text-[#0b1240] [&::-webkit-details-marker]:hidden">
          {peek}
          <span aria-hidden className="transition-transform group-open:rotate-180">&#x2304;</span>
        </summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-[#1426e6]/15 bg-[#f4f5fb] p-5 text-left font-mono text-[0.95rem] leading-relaxed text-[#0b1240]">{prompt}</pre>
      </details>
    </div>
  );
}
