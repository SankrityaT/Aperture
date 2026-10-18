"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Logo } from "@/components/Logo";

type Link = { label: string; href: string };

// Origin of the iris: the centre of the menu button, top right.
const IRIS_AT = "calc(100% - 38px) 32px";

function Burger({ open }: { open: boolean }) {
  // Two bars that cross into an X. Each bar is exactly as wide as the box, so it needs no horizontal centering:
  // a single transform (move + rotate) does all the positioning, with nothing else competing with it.
  const bar = "absolute left-0 top-[9.25px] h-[1.5px] w-5 rounded-full bg-current transition-transform duration-500 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]";
  return (
    <span aria-hidden className="relative block h-5 w-5">
      <span className={bar} style={{ transform: `translateY(${open ? 0 : -4}px) rotate(${open ? 45 : 0}deg)` }} />
      <span className={bar} style={{ transform: `translateY(${open ? 0 : 4}px) rotate(${open ? -45 : 0}deg)` }} />
    </span>
  );
}

// Sticky header: the logo, a pill of section links that follows the page, and the two actions.
// Below lg the links move into a full-screen menu that opens like an aperture.
export function Nav({ name, links, docs, github, start, cta }: { name: string; links: Link[]; docs: string; github: string; start: string; cta: string }) {
  const [active, setActive] = useState("");
  const [open, setOpen] = useState(false);
  // true on the client only, so the menu portal is never rendered on the server
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = links.map((l) => document.getElementById(l.href.slice(1))).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive("#" + e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((e) => io.observe(e));
    // above the first linked section there is nothing to highlight
    const clear = () => { if (window.scrollY < 400) setActive(""); };
    window.addEventListener("scroll", clear, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", clear); };
  }, [links]);

  const close = useCallback(() => {
    setOpen(false);
    burgerRef.current?.focus();
  }, []);

  // lock page scroll while the menu is open; Esc closes; Tab stays inside the panel; closes if the window grows to desktop
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const first = panelRef.current?.querySelector<HTMLElement>("button, a");
    window.setTimeout(() => first?.focus(), 80);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab" || !panelRef.current) return;
      const f = [...panelRef.current.querySelectorAll<HTMLElement>("button, a[href]")];
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open, close]);

  const items = [...links, { label: "Docs", href: docs }, { label: "GitHub", href: github }];

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#1426e6]/70 backdrop-blur-md">
        <div className="mx-auto grid h-16 max-w-[1320px] grid-cols-[1fr_auto] items-center gap-6 px-6 md:px-10 lg:grid-cols-[1fr_auto_1fr]">
          <a href="#top" className="flex w-fit items-center gap-2.5 font-newsreader text-xl" aria-label={`${name}, back to top`}>
            <Logo size={30} />
            {name}
          </a>

          <nav aria-label="Sections" className="hidden items-center gap-1 rounded-full border border-white/20 bg-white/[0.08] p-1 lg:flex">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                aria-current={active === l.href ? "true" : undefined}
                className={`rounded-full px-4 py-1.5 text-[0.95rem] transition ${active === l.href ? "bg-white text-[#1426e6]" : "text-[#f2f0ff]/90 hover:bg-white/15 hover:text-white"}`}
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center justify-end gap-4 text-[0.95rem] md:gap-6">
            <a href={docs} className="hidden text-[#f2f0ff]/90 transition hover:text-white lg:inline">Docs</a>
            <a href={github} className="hidden text-[#f2f0ff]/90 transition hover:text-white lg:inline">GitHub</a>
            <a href={start} className="hidden shrink-0 whitespace-nowrap rounded-full bg-white px-4 py-1.5 font-medium text-[#1426e6] transition hover:bg-[#e8ebff] md:inline-block">{cta}</a>
            <button
              ref={burgerRef}
              type="button"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen(true)}
              className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
            >
              <Burger open={false} />
            </button>
          </div>
        </div>
      </header>

      {mounted &&
        createPortal(
          <div
            id="mobile-menu"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            aria-hidden={!open}
            data-open={open ? "" : undefined}
            className="menu-iris fixed inset-0 z-50 h-dvh overflow-y-auto overscroll-contain bg-[#1426e6] text-white lg:hidden"
            style={{ ["--iris-at" as string]: IRIS_AT }}
          >
            <div className="relative mx-auto flex min-h-full max-w-[560px] flex-col px-6 pb-10">
              <div className="flex h-16 items-center justify-between">
                <span className="flex items-center gap-2.5 font-newsreader text-xl">
                  <Logo size={30} />
                  {name}
                </span>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={close}
                  className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Burger open />
                </button>
              </div>

              <nav aria-label="Menu" className="mt-8">
                <ul>
                  {items.map((l, i) => (
                    <li key={l.label} className="menu-item border-t border-white/20 last:border-b" style={{ transitionDelay: `${open ? 420 + i * 55 : 0}ms` }}>
                      <a
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="group flex items-baseline justify-between gap-4 py-4 font-newsreader text-[2.1rem] font-light leading-none tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
                      >
                        <span className="transition-transform duration-300 group-hover:translate-x-1.5">{l.label}</span>
                        <span aria-hidden className="font-mono text-sm tabular-nums text-white/70">{String(i + 1).padStart(2, "0")}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <div aria-hidden className="menu-mark my-6 flex flex-1 items-center justify-center [@media(max-height:700px)]:hidden">
                {/* opacity on the whole drawing, not on each stroke, so overlapping lines do not stack into bright spots */}
                <span className="text-white opacity-[0.16]">
                  <Logo size={176} />
                </span>
              </div>

              <div className="menu-item mt-6 flex flex-col gap-3" style={{ transitionDelay: `${open ? 420 + items.length * 55 + 40 : 0}ms` }}>
                <a href={start} onClick={() => setOpen(false)} className="rounded-full bg-white px-6 py-3.5 text-center text-base font-medium text-[#1426e6] transition hover:bg-[#e8ebff]">{cta}</a>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
