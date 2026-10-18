/**
 * Door: a gate wall of two piers under one beam, with a narrow door hung in the
 * gap. The pointer sets how far the door swings, by how close it is to the
 * doorway on the ground; as it opens, a row of dots on the floor beyond lights
 * up, nearest the door last. The slider is how far away the door notices you.
 *
 * The pattern: a field. One spring on the swing angle, a hit test on the
 * ground plane (which never moves), and the bright stroke handed from the
 * door at rest to the path it opens when the pointer chooses.
 */
const {
  Cam, clamp, facing, fillet, fit, poly, proj, rad, rings, seg, spring, stepS,
  unproj, flatDot, mk, place, pointer, prism, put, register, disposer, solid,
} = HL;

const WL = 36, WR = 84, WX = 120, WY = 14, PH = 58, BH = 14, DW = WR - WL, DH = 52, TK = 2.2;
const HX = WL, HY = 7, REST = 24, MAX = 68, N = 8, DOT_Y = (i) => -22 + i * 9.5;
const CX = (WL + WR) / 2;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let R = value;

  const C = Cam(45, 0.5, 1.5);
  fit(C, [[-16, -30, -4], [136, -30, 0], [-16, 62, 0], [136, 62, 0], [0, 0, PH + BH], [WX, WY, PH + BH], [WL + 14, 44, DH]], 200, 168);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const solidAt = (x0, y0, x1, y1, r, b, z0, z1) => {
    const [ring, inner] = rings(x0, y0, x1, y1, r, b), s = solid(g);
    put(s, prism(P, front, ring, inner, z0, z1));
    return s;
  };
  solidAt(-16, -30, 136, 62, 6, 1.4, -4, 0);

  const dots = [];
  for (let i = 0; i < N; i++) {
    const el = flatDot(g, C, 2.1, "dot off");
    place(el, P(CX, DOT_Y(i), 0));
    dots.push(el);
  }

  solidAt(0, 0, WL, WY, 3, 1.2, 0, PH);
  solidAt(WR, 0, WX, WY, 3, 1.2, 0, PH);
  solidAt(0, 0, WX, WY, 3, 1.2, PH, PH + BH);

  // the door, upright in its own plane, hung from its left edge
  const shape = fillet([[0, 0], [DW, 0], [DW, DH], [0, DH]], [1.4, 1.4, 3, 3]);
  const panel = fillet([[6, 6], [DW - 6, 6], [DW - 6, DH - 8], [6, DH - 8]], [1.2, 1.2, 1.2, 1.2]);
  const door = mk("g", {}, g);
  const back = mk("path", { class: "lo" }, door), face = mk("path", { class: "sil hi" }, door);
  const inset = mk("path", { class: "nf lo" }, door), grip = mk("path", { class: "nf" }, door);

  function draw(th) {
    const c = Math.cos(rad(th)), s = Math.sin(rad(th));
    const w = (u, z, o = 0) => P(HX + u * c - o * s, HY + u * s + o * c, z);
    back.setAttribute("d", poly(shape.map((p) => w(p[0], p[1], -TK))));
    face.setAttribute("d", poly(shape.map((p) => w(p[0], p[1]))));
    inset.setAttribute("d", poly(panel.map((p) => w(p[0], p[1]))));
    grip.setAttribute("d", seg(w(DW - 6, 21), w(DW - 6, 30)));
  }

  const sp = spring(REST, { eps: 0.05 });
  let over = null, lit = -1, drawn = NaN;
  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    if (sp.x !== drawn) {
      drawn = sp.x;
      draw(sp.x);
      const k = Math.round(clamp((sp.x - REST) / (MAX - REST), 0, 1) * N);
      if (k !== lit) { lit = k; dots.forEach((el, i) => { el.setAttribute("class", i < k ? "dot" : "dot off"); }); }
    }
    return m;
  });
  bag.add(B.unregister);

  function retarget() {
    if (!over) { sp.t = REST; face.classList.add("hi"); read.textContent = "rest"; B.wake(); return; }
    const d = Math.hypot(over[0] - CX, over[1] - HY), u = clamp(1 - d / R, 0, 1), f = u * u * (3 - 2 * u);
    sp.t = REST + (MAX - REST) * f;
    face.classList.remove("hi");
    read.textContent = "open " + Math.round(sp.t);
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => { over = unproj(C, p[0], p[1], 0); retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { R = v; if (over) retarget(); }, destroy: bag.dispose };
}

hairline({
  name: "door",
  means: "A gate wall with a narrow door: the nearer the pointer gets to the doorway, the wider it swings, and the path beyond lights up.",
  rules: [1, 3, 4, 8],
  range: [60, 110, 170],
  mount,
});
