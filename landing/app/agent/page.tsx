import type { Metadata } from "next";
import Link from "next/link";
import { CopyMarkdown } from "@/components/CopyMarkdown";
import { Logo } from "@/components/Logo";
import { ViewToggle } from "@/components/ViewToggle";
import { pageMarkdown } from "@/lib/markdown";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.name} for agents`,
  description: `${site.name} as plain markdown: the same page, in the form an agent reads.`,
  alternates: { canonical: "/agent", types: { "text/markdown": "/index.md" } },
  robots: { index: false },
};

const FILES = [
  { label: "Home", href: "/" },
  { label: "index.md", href: "/index.md" },
  { label: "llms.txt", href: "/llms.txt" },
  { label: "setup-prompt.txt", href: "/setup-prompt.txt" },
  { label: "mcp.json", href: "/.well-known/mcp.json" },
];

// The page as an agent reads it: markdown, in a monospace block, with the files an agent might ask for beside it.
export default function AgentView() {
  const md = pageMarkdown();
  return (
    <div className="min-h-screen bg-white text-[#0b1240] lg:grid lg:grid-cols-[300px_1fr]">
      <aside className="border-b border-[#1426e6]/10 px-6 py-6 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:px-9 lg:py-10">
        <Link href="/" className="flex w-fit items-center gap-2.5 font-newsreader text-2xl text-[#1426e6]" aria-label={`${site.name}, home`}>
          <Logo size={34} />
          <span className="text-[#0b1240]">{site.name}</span>
        </Link>
        <div className="mt-6">
          <ViewToggle current="agent" tone="light" />
        </div>
        <nav aria-label="Agent files" className="mt-8 hidden lg:block">
          <p className="font-mono text-sm uppercase tracking-wider text-[#5c6288]">Files</p>
          <ul className="mt-4 space-y-1">
            {FILES.map((f) => (
              <li key={f.href}>
                <a href={f.href} className="block rounded-lg px-3 py-2 font-mono text-[0.95rem] text-[#0b1240]/80 transition hover:bg-[#f4f5fb] hover:text-[#1426e6]">
                  {f.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="px-6 py-8 lg:px-14 lg:py-12">
        <div className="mx-auto max-w-[860px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.95rem] text-[#5c6288]">
              This is the page an agent reads. Request <code className="font-mono text-[#0b1240]">/</code> with <code className="font-mono text-[#0b1240]">Accept: text/markdown</code> to get it at the main address.
            </p>
            <CopyMarkdown text={md} />
          </div>
          <pre className="mt-6 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-[#1426e6]/12 bg-[#f7f8fd] p-6 font-mono text-[0.95rem] leading-[1.75] md:p-8">{md}</pre>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[0.95rem] lg:hidden">
            {FILES.map((f) => (
              <li key={f.href}>
                <a href={f.href} className="text-[#1426e6] underline underline-offset-4">{f.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
