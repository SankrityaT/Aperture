"use client";

import { useEffect, useRef } from "react";

type Palette = { plate: string; hi: string; edge: string; mid: string; lo: string };
type Handle = { set: (v: number) => void; destroy: () => void };
type Figure = {
  name: string;
  means: string;
  range: [number, number, number];
  mount: (ctx: { stage: HTMLElement; svg: SVGElement; read: { textContent: string | null } }, value: number) => Handle;
};
type Loaded = { HL: { inject: (root: Document) => void; mk: (tag: string, attrs: Record<string, string>, parent: Element) => SVGElement }; figure: Figure };

declare global {
  interface Window {
    __hairline?: Record<string, Loaded>;
  }
}

const loading = new Map<string, Promise<Loaded>>();
function load(name: string): Promise<Loaded> {
  const have = window.__hairline?.[name];
  if (have) return Promise.resolve(have);
  let p = loading.get(name);
  if (!p) {
    p = new Promise<Loaded>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `/hairline/${name}.js`;
      s.onload = () => (window.__hairline?.[name] ? resolve(window.__hairline[name]) : reject(new Error("figure missing")));
      s.onerror = () => reject(new Error("figure failed to load"));
      document.head.appendChild(s);
    });
    loading.set(name, p);
  }
  return p;
}

export function Hairline({
  name,
  palette,
  className = "",
  readClassName = "",
  play,
}: {
  name: string;
  palette: Palette;
  className?: string;
  readClassName?: string;
  /** Plays the pointer's answer once when scrolled into view: a viewBox point, and a delay in ms. */
  play?: { at: [number, number]; delay: number };
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let handle: Handle | undefined;
    let dead = false;
    let io: IntersectionObserver | undefined;
    const timers: number[] = [];
    load(name)
      .then(({ HL, figure }) => {
        if (dead) return;
        HL.inject(document);
        stage.setAttribute("data-hairline", figure.name);
        stage.setAttribute("role", "img");
        stage.setAttribute("aria-label", figure.means);
        const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage);
        const read = {
          get textContent() {
            return readRef.current?.textContent ?? null;
          },
          set textContent(v: string | null) {
            if (readRef.current) readRef.current.textContent = v ?? "";
          },
        };
        handle = figure.mount({ stage, svg, read }, figure.range[1]);
        read.textContent = "rest";

        if (play && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const fire = (type: string, at?: [number, number]) => {
            const r = stage.getBoundingClientRect();
            stage.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                pointerType: "mouse",
                clientX: r.left + ((at?.[0] ?? 0) / 400) * r.width,
                clientY: r.top + ((at?.[1] ?? 0) / 320) * r.height,
              }),
            );
          };
          io = new IntersectionObserver(
            ([e]) => {
              if (!e.isIntersecting) return;
              io?.disconnect();
              // the stagger is for wide screens; on a phone the figure plays as soon as it is in view
              const wait = window.matchMedia("(max-width: 767px)").matches ? 250 : play.delay;
              timers.push(window.setTimeout(() => fire("pointermove", play.at), wait));
              timers.push(window.setTimeout(() => fire("pointerleave"), wait + 2600));
            },
            { threshold: 0.35 },
          );
          io.observe(stage);
        }
      })
      .catch(() => {});
    return () => {
      dead = true;
      io?.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
      handle?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const style = {
    "--hairline-plate": palette.plate,
    "--hairline-hi": palette.hi,
    "--hairline-edge": palette.edge,
    "--hairline-mid": palette.mid,
    "--hairline-lo": palette.lo,
  } as React.CSSProperties;

  return (
    <div className={`relative ${className}`} style={style}>
      <div ref={stageRef} className="w-full" />
      <span ref={readRef} aria-hidden className={`pointer-events-none absolute bottom-2 right-2 font-mono text-xs tabular-nums ${readClassName}`} />
    </div>
  );
}
