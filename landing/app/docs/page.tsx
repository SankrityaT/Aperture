//created by kinjal
import type { Metadata } from "next";
import Link from "next/link";
import { CopyMarkdown } from "@/components/CopyMarkdown";
import { Logo } from "@/components/Logo";
import { docs, docsMarkdown, EFFECT_LABEL, tools, type Effect } from "@/lib/docs";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.name} docs`,
  description: `The ${site.name} MCP server: how to connect, how a change works, every tool with its parameters, and every error with its next move.`,
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs.md" } },
};

const INK = "text-[#0b1240]";
const GRAY = "text-[#5c6288]";
const h2 = "scroll-mt-24 text-balance font-newsreader text-[clamp(1.9rem,3.6vw,2.75rem)] font-light leading-[1.08] tracking-[-0.02em]";

const BADGE: Record<Effect, string> = {
  reads: "border-[#1426e6]/20 bg-[#eef0fd] text-[#1426e6]",
  changes: "border-[#0b1240]/15 bg-[#0b1240] text-white",
  outside: "border-[#b4231a]/25 bg-[#fdf1ef] text-[#9a1d15]",
};

function Badge({ effect }: { effect: Effect }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.8rem] font-medium ${BADGE[effect]}`}>{EFFECT_LABEL[effect]}</span>;
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-[#1426e6]/12 bg-[#f7f8fd] p-4 font-mono text-[0.88rem] leading-[1.7] md:p-5">{children}</pre>;
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "connect", label: "Connect" },
  { id: "lifecycle", label: "How a change works" },
  { id: "rules", label: "Rules for agents" },
  { id: "tools", label: "Tools" },
  { id: "errors", label: "Errors" },
  { id: "limits", label: "Limits" },
];

export default function Docs() {
  const md = docsMarkdown();
  return (
    <div className="min-h-screen bg-[#f4f5fb] p-3 sm:p-5 md:p-7">
      <div className="mx-auto max-w-[1680px] overflow-clip rounded-[18px] bg-white md:rounded-[24px]">
        {/* header band, in the landing page's blue */}
        <header className="bg-[#1426e6] text-[#f2f0ff]">
          <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-6 md:px-10">
            <Link href="/" className="flex items-center gap-2.5 font-newsreader text-xl" aria-label={`${site.name}, home`}>
              <Logo size={30} />
              {site.name}
            </Link>
            <nav aria-label="Site" className="flex items-center gap-1 rounded-full border border-white/20 bg-white/[0.08] p-1 text-[0.95rem]">
              <Link href="/" className="rounded-full px-3.5 py-1.5 text-[#f2f0ff]/90 transition hover:bg-white/15 hover:text-white">Home</Link>
              <span aria-current="page" className="rounded-full bg-white px-3.5 py-1.5 text-[#1426e6]">Docs</span>
              <a href="/docs.md" className="hidden rounded-full px-3.5 py-1.5 text-[#f2f0ff]/90 transition hover:bg-white/15 hover:text-white sm:inline">docs.md</a>
            </nav>
            <a href={site.github} className="hidden text-[0.95rem] text-[#f2f0ff]/90 transition hover:text-white sm:inline">GitHub</a>
          </div>
          <div className="mx-auto max-w-[1320px] px-6 pb-14 pt-10 md:px-10 md:pb-20 md:pt-14">
            <p className="font-mono text-sm uppercase tracking-wider text-[#f2f0ff]/75">MCP server · {docs.server.name} {docs.server.version} · {tools.length} tools</p>
            <h1 className="mt-4 max-w-[18ch] text-balance font-newsreader text-[clamp(2.5rem,5.8vw,4.75rem)] font-light leading-[1] tracking-[-0.02em]">
              The {site.name} <em className="italic">docs.</em>
            </h1>
            <p className="mt-6 max-w-[56ch] text-pretty text-lg leading-relaxed text-[#f2f0ff]/90">{docs.server.description}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <CopyMarkdown text={md} label="Copy docs for your agent" tone="blue" />
              <a href="/docs.md" className="rounded-full border border-white/40 px-6 py-3 text-base text-white transition hover:border-white hover:bg-white/10">Open docs.md</a>
            </div>
            <p className="mt-4 max-w-[60ch] text-[0.95rem] text-[#f2f0ff]/75">
              Agents can also fetch <code className="font-mono text-white">/docs</code> with <code className="font-mono text-white">Accept: text/markdown</code> and get the same file.
            </p>
          </div>
        </header>

        <div className={`mx-auto max-w-[1320px] lg:grid lg:grid-cols-[240px_1fr] lg:gap-14 ${INK}`}>
          <aside className="hidden border-r border-[#1426e6]/10 px-6 py-12 lg:block md:px-10">
            <nav aria-label="On this page" className="sticky top-8">
              <p className={`font-mono text-sm uppercase tracking-wider ${GRAY}`}>On this page</p>
              <ul className="mt-4 space-y-1">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="block rounded-lg px-3 py-1.5 text-[0.95rem] text-[#0b1240]/80 transition hover:bg-[#f4f5fb] hover:text-[#1426e6]">{s.label}</a>
                    {s.id === "tools" && (
                      <ul className="mb-2 ml-3 space-y-0.5 border-l border-[#1426e6]/12 pl-3">
                        {tools.map((t) => (
                          <li key={t.name}>
                            <a href={`#tool-${t.name}`} className="block py-0.5 font-mono text-[0.85rem] text-[#5c6288] transition hover:text-[#1426e6]">{t.name}</a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <main className="min-w-0 px-6 py-12 md:px-10 lg:pl-0 lg:pr-10">
            <div className="max-w-[860px] space-y-20">
              <section id="overview" className="scroll-mt-8">
                <h2 className={h2}>What it is for.</h2>
                <p className={`mt-5 text-pretty text-lg leading-relaxed ${GRAY}`}>{docs.intro}</p>
              </section>

              <section id="connect" className="scroll-mt-8">
                <h2 className={h2}>Connect.</h2>
                <p className={`mt-5 text-lg leading-relaxed ${GRAY}`}>
                  One endpoint, streamable HTTP: <code className="break-all font-mono text-[0.95rem] text-[#0b1240]">{site.mcpUrl}</code>
                </p>
                <div className="mt-6 space-y-5">
                  <div>
                    <p className="mb-2 font-medium">Claude Code</p>
                    <Code>{docs.connect.claudeCode}</Code>
                  </div>
                  <div>
                    <p className="mb-2 font-medium">Any MCP client</p>
                    <Code>{docs.connect.json}</Code>
                  </div>
                </div>
              </section>

              <section id="lifecycle" className="scroll-mt-8">
                <h2 className={h2}>How a change works.</h2>
                <ol className="mt-8 grid gap-4 sm:grid-cols-2">
                  {docs.lifecycle.map((s, i) => (
                    <li key={s.name} className="rounded-2xl border border-[#1426e6]/12 bg-[#f4f5fb] p-5">
                      <p className="font-mono text-sm tabular-nums text-[#1426e6]">{String(i + 1).padStart(2, "0")}</p>
                      <p className="mt-2 font-newsreader text-2xl">{s.name}</p>
                      <p className={`mt-2 leading-relaxed ${GRAY}`}>{s.text}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section id="rules" className="scroll-mt-8">
                <h2 className={h2}>Rules for agents.</h2>
                <ul className="mt-6 space-y-3">
                  {docs.rules.map((r) => (
                    <li key={r} className="flex gap-3 text-lg leading-relaxed">
                      <span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#1426e6]" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section id="tools" className="scroll-mt-8">
                <h2 className={h2}>Tools.</h2>
                <p className={`mt-5 text-lg leading-relaxed ${GRAY}`}>
                  {tools.length} tools. Names, parameters and types are taken from the live server; examples are from real eval runs on the GateAdmin32 replica.
                </p>
                <div className="mt-6 overflow-x-auto rounded-2xl border border-[#1426e6]/12">
                  <table className="w-full min-w-[560px] text-left text-[0.95rem]">
                    <thead className="bg-[#f4f5fb]">
                      <tr><th className="px-4 py-3 font-medium">Tool</th><th className="px-4 py-3 font-medium">Effect</th><th className="px-4 py-3 font-medium">Purpose</th></tr>
                    </thead>
                    <tbody>
                      {tools.map((t) => (
                        <tr key={t.name} className="border-t border-[#1426e6]/10 align-top">
                          <td className="px-4 py-3"><a href={`#tool-${t.name}`} className="font-mono text-[#1426e6] underline-offset-4 hover:underline">{t.name}</a></td>
                          <td className="whitespace-nowrap px-4 py-3"><Badge effect={t.effect} /></td>
                          <td className={`px-4 py-3 ${GRAY}`}>{t.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-12 space-y-8">
                  {tools.map((t) => (
                    <article key={t.name} id={`tool-${t.name}`} className="scroll-mt-8 rounded-2xl border border-[#1426e6]/12 p-6 md:p-8">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-mono text-xl font-medium">{t.name}</h3>
                        <Badge effect={t.effect} />
                      </div>
                      <p className="mt-4 text-lg leading-relaxed">{t.description}</p>
                      {t.params.length > 0 && (
                        <dl className="mt-6 divide-y divide-[#1426e6]/10 border-y border-[#1426e6]/10 md:hidden">
                          {t.params.map((p) => (
                            <div key={p.name} className="py-3">
                              <dt className="font-mono">
                                {p.name}
                                {p.required && <span className="ml-1.5 rounded bg-[#eef0fd] px-1.5 py-0.5 font-sans text-[0.72rem] text-[#1426e6]">required</span>}
                                <span className={`ml-2 text-[0.85rem] ${GRAY}`}>{p.type}</span>
                              </dt>
                              {p.description && <dd className={`mt-1 ${GRAY}`}>{p.description}</dd>}
                            </div>
                          ))}
                        </dl>
                      )}
                      {t.params.length > 0 ? (
                        <div className="mt-6 hidden overflow-x-auto md:block">
                          <table className="w-full min-w-[520px] text-left text-[0.92rem]">
                            <thead className={GRAY}>
                              <tr><th className="pb-2 pr-4 font-normal">Parameter</th><th className="pb-2 pr-4 font-normal">Type</th><th className="pb-2 font-normal">Description</th></tr>
                            </thead>
                            <tbody>
                              {t.params.map((p) => (
                                <tr key={p.name} className="border-t border-[#1426e6]/10 align-top">
                                  <td className="py-2.5 pr-4 font-mono">
                                    {p.name}
                                    {p.required && <span className="ml-1.5 rounded bg-[#eef0fd] px-1.5 py-0.5 font-sans text-[0.72rem] text-[#1426e6]">required</span>}
                                  </td>
                                  <td className={`py-2.5 pr-4 font-mono text-[0.85rem] ${GRAY}`}>{p.type}</td>
                                  <td className={`py-2.5 ${GRAY}`}>{p.description || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className={`mt-4 ${GRAY}`}>No parameters.</p>
                      )}
                      {t.example && (
                        <div className="mt-6">
                          <p className={`mb-2 text-sm uppercase tracking-wider ${GRAY}`}>Example</p>
                          <Code>{`${t.example.call}\n\n${t.example.result}`}</Code>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>

              <section id="errors" className="scroll-mt-8">
                <h2 className={h2}>Errors.</h2>
                <p className={`mt-5 text-lg leading-relaxed ${GRAY}`}>
                  Every refusal returns <code className="font-mono text-[#0b1240]">error</code>, <code className="font-mono text-[#0b1240]">detail</code> and a <code className="font-mono text-[#0b1240]">next</code> list of valid next moves.
                </p>
                <div className="mt-6 overflow-x-auto rounded-2xl border border-[#1426e6]/12">
                  <table className="w-full min-w-[640px] text-left text-[0.92rem]">
                    <thead className="bg-[#f4f5fb]">
                      <tr><th className="px-4 py-3 font-medium">error</th><th className="px-4 py-3 font-medium">Meaning</th><th className="px-4 py-3 font-medium">Next move</th></tr>
                    </thead>
                    <tbody>
                      {docs.errors.map(([e, m, x]) => (
                        <tr key={e} className="border-t border-[#1426e6]/10 align-top">
                          <td className="px-4 py-3 font-mono text-[#1426e6]">{e}</td>
                          <td className={`px-4 py-3 ${GRAY}`}>{m}</td>
                          <td className="px-4 py-3">{x}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={`mt-5 leading-relaxed ${GRAY}`}>{docs.receipts}</p>
              </section>

              <section id="limits" className="scroll-mt-8">
                <h2 className={h2}>Limits.</h2>
                <ul className="mt-6 space-y-3">
                  {docs.limits.map((l) => (
                    <li key={l} className="flex gap-3 text-lg leading-relaxed">
                      <span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#5c6288]" />
                      <span>{l}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl bg-[#1426e6] p-8 text-[#f2f0ff] md:p-10">
                <p className="font-newsreader text-3xl font-light">Hand these docs to your agent.</p>
                <p className="mt-3 max-w-[52ch] text-[#f2f0ff]/85">One click copies the whole page as markdown: connection, rules, every tool and every error.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <CopyMarkdown text={md} label="Copy docs for your agent" tone="blue" />
                  <a href="/docs.md" className="rounded-full border border-white/40 px-6 py-3 text-base text-white transition hover:border-white hover:bg-white/10">Open docs.md</a>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
