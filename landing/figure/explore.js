/**
 * Explore: a web page standing as a slab, with its header, two fields, a list
 * and a button in relief on its face. A scanner on a rail in front sweeps with
 * the pointer; each part it has passed gets a bright dot, as if found. The
 * slider is the scanner's width.
 *
 * The pattern: a field along one axis. One spring on the scan position, a hit
 * test on a fixed horizontal plane, and the bright stroke handed from the
 * scanner at rest to the dots it has earned.
 */
const {
  Cam, clamp, facing, fillet, fit, poly, proj, prism, rings, put, solid, spring, stepS, unproj,
  mk, place, pointer, register, disposer,
} = HL;

const W = 110, T = 6, H = 84, RY = T + 7, REST = 16;
// the parts on the page: x0, z0, x1, z1
const PARTS = [[8, 66, 102, 78], [8, 36, 60, 52], [8, 14, 60, 30], [70, 36, 102, 50], [70, 14, 102, 30]];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let bw = value;

  const C = Cam(45, 0.5, 2.3);
  fit(C, [[0, 0, 0], [W, 0, H + 4], [W, RY + 4, 0], [0, RY + 4, H + 4]], 200, 168);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const page = rings(0, 0, W, T, 3, 1.2), pg = solid(g);
  put(pg, prism(P, front, page[0], page[1], 0, H));

  const dots = PARTS.map(([x0, z0, x1, z1]) => {
    const shape = fillet([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [2.4, 2.4, 2.4, 2.4]);
    mk("path", { d: poly(shape.map((p) => P(p[0], T + 0.1, p[1]))), class: "nf lo" }, g);
    return { el: mk("circle", { r: 1.7, class: "dot off" }, g), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  });
  dots.forEach((d) => place(d.el, P(d.cx, T + 0.2, d.cz)));

  const rail = rings(-6, RY - 3, W + 6, RY + 3, 2, 0.7), rl = solid(g);
  put(rl, prism(P, front, rail[0], rail[1], 0, 2.5));
  const bar = solid(g);
  bar.sil.classList.add("hi");

  const sp = spring(REST, { eps: 0.05 });
  let over = false, drawn = NaN, lit = -1;
  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    if (sp.x !== drawn) {
      drawn = sp.x;
      const x0 = sp.x - bw / 2, x1 = sp.x + bw / 2, [r, ri] = rings(x0, RY - 1.5, x1, RY + 1.5, 1.2, 0.45);
      put(bar, prism(P, front, r, ri, 2.5, H + 3));
      const k = dots.reduce((n, d, i) => { const on = d.cx < sp.x; dots[i].el.setAttribute("class", on ? "dot" : "dot off"); return n + (on ? 1 : 0); }, 0);
      if (k !== lit) { lit = k; if (over) read.textContent = "found " + k; }
    }
    return m;
  });
  bag.add(B.unregister);

  function aim(x) {
    over = x !== null;
    sp.t = over ? clamp(x, -2, W + 2) : REST;
    bar.sil.classList.toggle("hi", !over);
    if (!over) read.textContent = "rest";
    else { lit = -1; drawn = NaN; }
    B.wake();
  }
  bag.add(pointer(stage, { move: (p) => aim(unproj(C, p[0], p[1], H / 2)[0]), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { bw = v; drawn = NaN; B.wake(); }, destroy: bag.dispose };
}

hairline({
  name: "explore",
  means: "A web page with five parts in relief: a scanner sweeps it with the pointer and every part it passes is marked found.",
  rules: [1, 3, 4, 8],
  range: [3, 8, 18],
  mount,
});
