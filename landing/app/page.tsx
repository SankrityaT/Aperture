import Image from "next/image";
import { SectionIcon, type SectionIconName } from "@/components/SectionIcon";
import { Logo } from "@/components/Logo";
import { Hairline } from "@/components/Hairline";
import { Nav } from "@/components/Nav";
import { Reveal } from "@/components/Reveal";
import { CopySetupLink } from "@/components/CopySetupLink";
import { SetupPrompt } from "@/components/SetupPrompt";
import { jsonLd } from "@/lib/jsonld";
import { site, copy, setupPrompt } from "@/lib/site";

const palette = { plate: "#1426e6", hi: "#ffffff", edge: "#c3caff", mid: "#8593ff", lo: "#4659f0" };
// where each step's figure plays its answer when it scrolls into view (viewBox points)
const PLAY: [number, number][] = [[245, 187], [334, 224], [249, 223], [289, 217]];
const FIGURES = ["explore", "compile", "execute", "verify"];
const h2 = "text-balance font-newsreader text-[clamp(2.25rem,5vw,4.25rem)] font-light leading-[1.05] tracking-[-0.02em]";

const TAGS = ["Compatibility", "Reuse", "Boundaries", "Visibility"];
const dim = "text-[#f2f0ff]/65";

// one small picture per card; copy is generic on purpose, nothing here is a claim about a customer (the measured numbers live in copy.evidence)
function Tree({ rows }: { rows: string[] }) {
  return (
    <ul className="w-full space-y-4 pl-3 text-lg">
      {rows.map((r, i) => (
        <li key={r} className={`relative pl-10 ${i === rows.length - 1 ? "text-white" : dim}`}>
          <span aria-hidden className="absolute -top-6 left-2 h-[2.2rem] w-7 rounded-bl-2xl border-b border-l border-white/40" />
          <span className="inline-flex items-center gap-3">
            <span aria-hidden className={`h-2 w-2 rounded-full ${i === rows.length - 1 ? "bg-white" : "border border-white/50"}`} />
            {r}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Runs() {
  return (
    <div className="flex w-full flex-col items-start text-lg">
      <span className="rounded-lg border border-dashed border-white/45 px-3 py-2 text-[#f2f0ff]/80">Explored once</span>
      <span aria-hidden className="ml-8 h-6 w-px bg-white/40" />
      <div className="flex flex-wrap gap-3">
        {[1, 2, 3].map((k) => (
          <span key={k} data-lit style={{ ["--reveal-delay" as string]: `${700 + k * 450}ms` }} className="inline-flex items-center gap-2 rounded-lg border border-white/50 bg-white/10 px-3 py-2 font-mono text-base">
            <span aria-hidden className="h-2 w-2 rounded-full bg-white" />
            run {String(k).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}

function Limit() {
  return (
    <div className="w-full">
      <div className="relative h-3 rounded-full bg-white/15">
        <div data-line className="absolute inset-y-0 left-0 w-[68%] rounded-full bg-white" style={{ ["--reveal-delay" as string]: "500ms" }} />
        <div aria-hidden className="absolute -inset-y-2 left-[68%] w-px bg-white" />
        <div aria-hidden className="absolute inset-y-0 left-[68%] right-0 rounded-r-full border-y border-r border-dashed border-white/40" />
      </div>
      <div className="mt-5 flex justify-between text-lg">
        <span>Inside the limit: runs</span>
        <span className={dim}>Beyond: asks first</span>
      </div>
    </div>
  );
}

function Receipt() {
  const rows: [string, string, boolean][] = [["Changed", "1 record", false], ["Read back", "matches", false], ["Recovery", "incomplete", true]];
  return (
    <div className="w-full rounded-xl border border-white/25 bg-white/[0.07] p-5 font-mono text-base">
      {rows.map(([k, v, flag], i) => (
        <div key={k} data-lit style={{ ["--reveal-delay" as string]: `${500 + i * 450}ms` }} className={`flex items-center justify-between py-2 ${i ? "border-t border-white/15" : ""}`}>
          <span className={dim}>{k}</span>
          <span className="inline-flex items-center gap-2">
            {flag && <span aria-hidden className="h-2 w-2 rounded-full bg-white" />}
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

const VIGNETTES: ((n: string) => React.ReactNode)[] = [
  () => <Tree rows={["Your existing app", "No rebuild", "Agent-ready"]} />,
  () => <Runs />,
  () => <Limit />,
  () => <Receipt />,
];

function Button({ href, children, solid, onLight }: { href: string; children: React.ReactNode; solid?: boolean; onLight?: boolean }) {
  const cls = onLight
    ? solid
      ? "bg-[#1426e6] text-white hover:bg-[#0f1fc4]"
      : "border border-[#1426e6]/40 text-[#1426e6] hover:border-[#1426e6]"
    : solid
      ? "bg-white text-[#1426e6] hover:bg-[#e8ebff]"
      : "border border-white/60 hover:border-white";
  return (
    <a href={href} className={`whitespace-nowrap rounded-full px-6 py-3 text-base ${solid ? "font-medium" : ""} transition ${cls}`}>
      {children}
    </a>
  );
}

// The label hanging from a section's top line: a promise, with a door that opens a little more each time.
function Eyebrow({ children, light, icon }: { children: React.ReactNode; light?: boolean; icon: SectionIconName }) {
  return (
    <Reveal className="mx-auto w-fit">
      <div className={`flex items-center gap-3 border-x border-b px-8 py-4 text-[1.15rem] font-medium tracking-[-0.01em] ${light ? "border-[#1426e6]/15 text-[#0b1240]" : "border-white/25 text-white"}`}>
        <span className={light ? "text-[#1426e6]" : "text-white"}>
          <SectionIcon name={icon} />
        </span>
        {children}
      </div>
    </Reveal>
  );
}

// Side margins for every section but the hero: three patterned columns (scan, gates, cloud) outside the content lines,
// drawn as masks so one set of files serves both the blue and the white sections. The right side mirrors the left.
const COLS = [
  { file: "scan", w: 32, h: 240 },
  { file: "gates", w: 60, h: 128 },
  { file: "cloud", w: 32, h: 480 },
];
function Margin({ mirror }: { mirror?: boolean }) {
  return (
    <div className={`absolute top-0 flex h-full ${mirror ? "left-full -scale-x-100" : "right-full"}`}>
      {COLS.map((c) => (
        <div key={c.file} style={{ width: c.w + 2 }} className="h-full border-l border-current/60">
          <div
            className="h-full bg-current"
            style={{
              width: c.w,
              maskImage: `url(/pattern/${c.file}.svg)`,
              WebkitMaskImage: `url(/pattern/${c.file}.svg)`,
              maskRepeat: "repeat-y",
              WebkitMaskRepeat: "repeat-y",
              maskSize: `${c.w}px ${c.h}px`,
              WebkitMaskSize: `${c.w}px ${c.h}px`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
function Margins({ light }: { light?: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 left-1/2 hidden w-[1148px] -translate-x-1/2 border-x border-current/60 min-[1400px]:block ${light ? "text-[#1426e6]/[0.18]" : "text-white/[0.2]"}`}
    >
      <Margin />
      <Margin mirror />
    </div>
  );
}

const NAV_LINKS = [
  { label: "How it works", href: "#how" },
  { label: "See it work", href: "#action" },
  { label: "Built for agents", href: "#built" },
  { label: "Works with", href: "#agents" },
  { label: "FAQ", href: "#faq" },
];

const FOOTER_LINKS = [
  { title: "Product", links: [{ label: "How it works", href: "#how" }, { label: "See it work", href: "#action" }, { label: "Built for agents", href: "#built" }, { label: "Works with your agent", href: "#agents" }, { label: "FAQ", href: "#faq" }] },
  { title: "Developers", links: [{ label: "Docs", href: site.docs }, { label: "GitHub", href: site.github }] },
];

const INK = "text-[#0b1240]";
const GRAY = "text-[#5c6288]";

export default function Home() {
  const n = site.name;
  return (
    <div className="min-h-screen bg-[#f4f5fb] p-3 sm:p-5 md:p-7">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()).replace(/</g, "\\u003c") }} />
    <main className="relative mx-auto max-w-[1680px] overflow-clip rounded-[18px] bg-[#1426e6] text-[#f2f0ff] md:rounded-[24px]">
      <Nav name={n} links={NAV_LINKS} docs={site.docs} github={site.github} />

      {/* hero */}
      <section id="top" className="relative -mt-16 min-h-[860px] overflow-hidden pt-16 md:min-h-[max(700px,calc(100dvh-136px))]">
        {/* the cove at its own pixel size (1456 x 816), centered; sides fade into the blue on screens wider than it */}
        <div
          aria-hidden
          className="absolute left-1/2 h-[816px] w-[1456px] -translate-x-1/2"
          style={{
            top: "max(143px, calc(100% - 701px))",
            backgroundImage: "url(/scenes/cove.png)",
            backgroundSize: "1456px 816px",
            imageRendering: "pixelated",
            maskImage: "linear-gradient(to bottom, transparent 0, #000 18%), linear-gradient(to right, transparent 0, #000 7%, #000 93%, transparent 100%)",
            maskComposite: "intersect",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 18%), linear-gradient(to right, transparent 0, #000 7%, #000 93%, transparent 100%)",
            WebkitMaskComposite: "source-in",
          }}
        />
        <div className="relative z-10 mx-auto flex max-w-[1100px] flex-col items-center px-6 pt-10 text-center">
          <h1 className="text-balance font-newsreader text-[clamp(2.5rem,5.8vw,5.25rem)] font-light leading-[1] tracking-[-0.02em]">
            Give agents the web they <em className="italic">deserve.</em>
          </h1>
          <p className="mt-6 max-w-[50ch] text-balance text-lg leading-relaxed text-[#f2f0ff]/90">{copy.heroSub(n)}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href={site.github} solid>{copy.secondary}</Button>
          </div>
          <CopySetupLink prompt={setupPrompt(n, site.slug, site.mcpUrl)} ask={copy.agents.ask} copy={copy.agents.copy} copied={copy.agents.copied} />
        </div>
      </section>

      {/* problem */}
      <section className={`relative border-t border-[#1426e6]/10 bg-white ${INK}`}>
        <Margins light />
        <Eyebrow light icon="closed">Doors made for people</Eyebrow>
        <div className="relative mx-auto max-w-[1040px] px-6 pb-16 pt-20 text-center md:pb-40 md:pt-28">
          <Reveal>
            <p className="text-balance font-newsreader text-[clamp(1.9rem,4.3vw,3.6rem)] font-light leading-[1.14] tracking-[-0.015em]">
              <span>{copy.problem.title} </span>
              <span className={GRAY}>{copy.problem.paras(n).slice(0, 2).join(" ")} </span>
              <span>{copy.problem.paras(n)[2]}</span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="relative scroll-mt-16 border-t border-white/20">
        <Margins />
        <Eyebrow icon="arch">Knock once</Eyebrow>
        <div className="mx-auto max-w-[1100px] px-6 pb-16 pt-20 md:pb-40 md:pt-28">
          <Reveal>
            <h2 className={`${h2} max-w-[16ch]`}>{copy.how.title}</h2>
          </Reveal>
          <ol className="mt-16 grid gap-14 md:mt-24 md:grid-cols-4 md:gap-0">
            {copy.how.steps(n).map((s, i) => (
              <li key={s.n} className="md:pr-8">
                <Reveal delay={i * 380}>
                  <Hairline
                    name={FIGURES[i]}
                    palette={palette}
                    play={{ at: PLAY[i], delay: 900 + i * 380 }}
                    className="mx-auto mb-4 w-full max-w-[320px] md:max-w-none"
                    readClassName="text-sm text-white/85"
                  />
                  <div className="relative h-px bg-white/20 md:-mr-8">
                    <div data-line className="absolute inset-0 bg-white" style={{ ["--reveal-delay" as string]: `${i * 380}ms` }} />
                    <span aria-hidden className="absolute -top-[4px] left-0 h-[9px] w-[9px] rounded-full bg-white" />
                  </div>
                  <p className="mt-6 font-mono text-sm tabular-nums tracking-wide text-[#f2f0ff]/85">{s.n}</p>
                  <h3 className="mt-3 text-balance font-newsreader text-[2rem] leading-tight">{s.name}</h3>
                  <p className="mt-3 text-pretty text-lg leading-relaxed text-[#f2f0ff]/90">{s.text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* in action: a slot for the recording, until there is one */}
      <section id="action" className={`relative scroll-mt-16 border-t border-[#1426e6]/10 bg-white ${INK}`}>
        <Margins light />
        <Eyebrow light icon="filled">Watch it open</Eyebrow>
        <div className="relative mx-auto max-w-[1040px] px-6 pb-16 pt-20 md:pb-40 md:pt-28">
          <Reveal className="text-center">
            <h2 className={`${h2} mx-auto max-w-[16ch]`}>See it work.</h2>
            <p className={`mx-auto mt-6 max-w-[46ch] text-pretty text-xl leading-relaxed ${GRAY}`}>
              An agent calls a tool, the change is previewed, and the result is read back.
            </p>
          </Reveal>
          <Reveal delay={160} className="mt-14 rounded-2xl border border-[#1426e6]/15 bg-[#f4f5fb] p-3 md:mt-20 md:p-4">
            <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-[#1426e6]/35 text-center">
              <div>
                <p className="font-newsreader text-2xl">Demo recording goes here</p>
                <p className={`mt-2 font-mono text-base ${GRAY}`}>16:9 &middot; GIF or MP4</p>
              </div>
            </div>
          </Reveal>
          <Reveal className="mt-24 text-center md:mt-36">
            <h2 className={`${h2} mx-auto max-w-[16ch]`}>{copy.evidence.title}</h2>
            <p className={`mx-auto mt-6 max-w-[46ch] text-pretty text-xl leading-relaxed ${GRAY}`}>{copy.evidence.sub}</p>
          </Reveal>
          <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-3 md:gap-5">
            {copy.evidence.stats(n).map((st, i) => (
              <Reveal key={st.head} delay={i * 140}>
                <article className="flex h-full flex-col rounded-2xl border border-[#1426e6]/15 bg-[#f4f5fb] p-6 md:p-7">
                  <p className="font-newsreader text-[clamp(3rem,6vw,4.5rem)] font-light leading-none tracking-[-0.02em] text-[#1426e6]">{st.big}</p>
                  <p className={`mt-2 font-mono text-base ${GRAY}`}>{st.unit}</p>
                  <h3 className="mt-8 font-newsreader text-[1.5rem] leading-tight">{st.head}</h3>
                  <p className={`mt-3 text-pretty text-lg leading-relaxed ${GRAY}`}>{st.text}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <p className={`mx-auto mt-8 max-w-[60ch] text-center font-mono text-sm ${GRAY}`}>{copy.evidence.note}</p>
        </div>
      </section>

      {/* built for agents */}
      <section id="built" className="relative scroll-mt-16 border-t border-white/20">
        <Margins />
        <Eyebrow icon="logo">Keys and receipts</Eyebrow>
        <div className="mx-auto max-w-[1100px] px-6 pb-16 pt-20 md:pb-40 md:pt-28">
          <Reveal>
            <h2 className={`${h2} max-w-[22ch]`}>{copy.built.title}</h2>
          </Reveal>
          <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2 md:gap-5">
            {copy.built.items.map((it, i) => (
              <Reveal key={it.name} delay={(i % 2) * 140}>
                <article className="flex h-full flex-col rounded-2xl border border-white/20 bg-white/[0.05] p-6 md:p-7">
                  <span className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-[0.95rem]">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
                    {TAGS[i]}
                  </span>
                  <div className="my-8 flex min-h-[184px] items-center">{VIGNETTES[i](n)}</div>
                  <h3 className="font-newsreader text-[1.75rem] leading-tight">{it.name}</h3>
                  <p className="mt-3 max-w-[40ch] text-pretty text-lg leading-relaxed text-[#f2f0ff]/90">{it.text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* works with your agent */}
      <section id="agents" className={`relative scroll-mt-16 border-t border-[#1426e6]/10 bg-white ${INK}`}>
        <Margins light />
        <Eyebrow light icon="open">{copy.agents.label}</Eyebrow>
        <div className="relative mx-auto max-w-[1040px] px-6 pb-16 pt-20 text-center md:pb-40 md:pt-28">
          <Reveal>
            <h2 className={`${h2} mx-auto max-w-[18ch]`}>{copy.agents.title}</h2>
            <p className={`mx-auto mt-6 max-w-[44ch] text-pretty text-xl leading-relaxed ${GRAY}`}>{copy.agents.sub(n)}</p>
          </Reveal>
          <Reveal className="relative mx-auto mt-14 max-w-[830px] md:mt-20">
            <ul className="flex flex-wrap justify-center gap-3 sm:gap-4 md:gap-[22px] [mask-image:linear-gradient(to_bottom,#000_56%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_56%,transparent_100%)]">
              {copy.agents.clients.map((c, i) => (
                <li key={c.name} title={c.name} className="last:hidden md:last:list-item">
                  <span
                    data-lit
                    style={{ ["--reveal-delay" as string]: `${i * 45}ms` }}
                    className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] border border-[#1426e6]/10 bg-white shadow-[0_1px_2px_rgba(20,38,230,0.06),0_6px_16px_-8px_rgba(20,38,230,0.25)] transition-transform duration-300 hover:-translate-y-1 sm:h-[72px] sm:w-[72px] md:h-[80px] md:w-[80px] md:rounded-[22px]"
                  >
                    <Image src={`/logos/${c.logo}.svg`} alt={c.name} width={40} height={40} unoptimized className="h-8 w-8 md:h-10 md:w-10" />
                  </span>
                </li>
              ))}
            </ul>
            {/* a hint of softness over the last row only; the fade itself is the mask on the list above */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%] backdrop-blur-[1px] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_70%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,#000_70%)]" />
          </Reveal>
          <p className={`mt-6 text-lg ${GRAY}`}>{copy.agents.more}</p>
          <Reveal delay={200} className="mt-10 md:mt-12">
            <SetupPrompt prompt={setupPrompt(n, site.slug, site.mcpUrl)} ask={copy.agents.ask} copy={copy.agents.copy} copied={copy.agents.copied} peek={copy.agents.peek} />
          </Reveal>
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="relative scroll-mt-16 border-t border-white/20">
        <Margins />
        <Eyebrow icon="ask">Straight answers</Eyebrow>
        <div className="mx-auto grid max-w-[1100px] gap-12 px-6 pb-16 pt-20 md:grid-cols-[0.85fr_1.5fr] md:gap-20 md:pb-40 md:pt-28">
          <Reveal>
            <h2 className={`${h2} md:sticky md:top-28`}>{copy.faq.title}</h2>
          </Reveal>
          <div className="border-b border-white/25">
            {copy.faq.items(n).map((it, i) => (
              <details key={it.q} open={i === 0} className="group border-t border-white/25">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left [&::-webkit-details-marker]:hidden">
                  <span className="font-newsreader text-[1.5rem] leading-snug md:text-[1.65rem]">{it.q}</span>
                  <span aria-hidden className="relative h-4 w-4 shrink-0">
                    <span className="absolute left-0 top-1/2 h-px w-4 bg-white" />
                    <span className="absolute left-1/2 top-0 h-4 w-px bg-white transition-transform duration-300 group-open:scale-y-0" />
                  </span>
                </summary>
                <p className="faq-a max-w-[58ch] pb-7 text-pretty text-lg leading-relaxed text-[#f2f0ff]/90">{it.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* closing */}
      <section className={`relative border-t border-[#1426e6]/10 bg-white ${INK}`}>
        <Margins light />
        <Eyebrow light icon="logo">Walk right in</Eyebrow>
        <div className="relative z-10 mx-auto flex max-w-[900px] flex-col items-center px-6 pb-16 pt-20 text-center md:pb-40 md:pt-28">
          <Reveal>
            <h2 className={h2}>{copy.close.title}</h2>
          </Reveal>
          <Reveal delay={120} className={`mt-8 space-y-1 text-balance text-xl leading-relaxed ${GRAY}`}>
            {copy.close.paras(n).map((p) => (
              <p key={p}>{p}</p>
            ))}
          </Reveal>
          <Reveal delay={240} className="mt-10 flex flex-wrap justify-center gap-3">
            <Button href={site.start} solid onLight>{copy.close.primary}</Button>
            <Button href={site.docs} onLight>{copy.close.secondary}</Button>
          </Reveal>
        </div>
      </section>

      <footer className="relative overflow-hidden border-t border-white/20">
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[78%] bg-cover bg-bottom"
          style={{
            backgroundImage: "url(/dither/footer.png)",
            maskImage: "linear-gradient(to bottom, transparent 0, #000 45%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 45%)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-[1148px] px-6 pt-16 md:pt-20">
          <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div>
              <span className="flex items-center gap-3 font-newsreader text-3xl"><Logo size={36} />{n}</span>
              <p className="mt-4 max-w-[26ch] text-pretty text-lg leading-relaxed text-[#f2f0ff]/90">{copy.sub(n)}</p>
            </div>
            {FOOTER_LINKS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <p className="font-mono text-sm uppercase tracking-wider text-[#f2f0ff]/80">{col.title}</p>
                <ul className="mt-5 space-y-3 text-lg">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} className="text-white transition hover:underline hover:underline-offset-4">{l.label}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <div className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-white/25 pt-6 text-[0.95rem] text-[#f2f0ff]/90 md:mt-24">
            <span className="font-mono tabular-nums">&copy; 2026 {n}</span>
            <a href="#top" className="hover:underline hover:underline-offset-4">Back to top</a>
          </div>
        </div>
        <div aria-hidden className="relative z-10 -mb-[0.16em] mt-14 select-none text-center font-newsreader text-[clamp(5rem,25vw,24rem)] font-light leading-[0.8] tracking-[-0.03em] text-white">{n}</div>
      </footer>
    </main>
    </div>
  );
}
