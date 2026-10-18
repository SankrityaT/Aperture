/**
 * Execute: a parcel on a track runs through a gate. The pointer's position
 * along the track carries the parcel; the dots it has passed light up, and the
 * gate stays where it is. The slider is the parcel's size.
 *
 * The pattern: scrub along one axis. A spring on the parcel's position, a hit
 * test on the ground plane, and a paint order that changes as the parcel
 * passes through the gate, so the near post covers it while it is inside.
 */
const {
  Cam, clamp, facing, fit, proj, prism, rings, put, solid, spring, stepS, unproj,
  mk, place, pointer, register, disposer,
} = HL;

const L = 140, TW = 26, PX0 = 62, PX1 = 72, PH = 46, BEAM = 8, N = 8, REST = 14;
const DOT_X = (i) => 10 + i * 17.5;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let ps = value;

  const C = Cam(45, 0.5, 2.3);
  fit(C, [[0, 0, -4], [L, 0, 0], [0, TW, 0], [L, TW, 0], [PX0, 0, PH + BEAM], [PX1, TW, PH + BEAM]], 200, 170);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const post = (y0, y1) => { const [r, ri] = rings(PX0, y0, PX1, y1, 1.6, 0.7), s = solid(g); put(s, prism(P, front, r, ri, 0, PH)); return s; };
  const [tr, ti] = rings(0, 0, L, TW, 5, 1.4), track = solid(g);
  put(track, prism(P, front, tr, ti, -4, 0));
  const dots = Array.from({ length: N }, (_, i) => { const el = mk("ellipse", { rx: 2.2 * C.S, ry: 2.2 * C.S * C.k, class: "dot off" }, g); place(el, P(DOT_X(i), TW / 2, 0)); return el; });
  const back = post(0, 5), cargo = solid(g);
  post(TW - 5, TW);
  const [br, bi] = rings(PX0, 0, PX1, TW, 1.6, 0.7), beam = solid(g);
  put(beam, prism(P, front, br, bi, PH, PH + BEAM));
  cargo.sil.classList.add("hi");

  const sp = spring(REST, { eps: 0.05 });
  let over = false, lit = -1, drawn = NaN;
  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    if (sp.x !== drawn) {
      drawn = sp.x;
      const x0 = sp.x, x1 = sp.x + ps, y0 = TW / 2 - ps / 2, [r, ri] = rings(x0, y0, x1, y0 + ps, Math.min(2.4, ps / 3), 0.9);
      put(cargo, prism(P, front, r, ri, 0, ps * 0.85));
      // before the gate the cargo is behind it; inside, the near post covers it; past it, it is in front
      if (x1 <= PX0) g.insertBefore(cargo.g, back.g);
      else if (x0 >= PX1) beam.g.after(cargo.g);
      else back.g.after(cargo.g);
      const k = dots.reduce((n, el, i) => { const on = DOT_X(i) < x0 + ps / 2; el.setAttribute("class", on && over ? "dot" : "dot off"); return n + (on ? 1 : 0); }, 0);
      if (k !== lit) { lit = k; if (over) read.textContent = "run " + k + "/" + N; }
    }
    return m;
  });
  bag.add(B.unregister);

  function aim(x) {
    over = x !== null;
    sp.t = over ? clamp(x - ps / 2, 0, L - ps) : REST;
    cargo.sil.classList.toggle("hi", !over);
    if (!over) read.textContent = "rest";
    lit = -1; drawn = NaN;
    B.wake();
  }
  bag.add(pointer(stage, { move: (p) => aim(unproj(C, p[0], p[1], 0)[0]), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { ps = v; drawn = NaN; B.wake(); }, destroy: bag.dispose };
}

hairline({
  name: "execute",
  means: "A parcel rides a track through a gate as the pointer moves along it, and the dots it passes light up.",
  rules: [1, 4, 6, 8],
  range: [9, 12, 16],
  mount,
});
