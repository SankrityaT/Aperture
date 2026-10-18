/**
 * Verify: six tiles stand in a rail, and one of them leans, the one that went
 * wrong. The pointer checks along the row; each tile it reaches gets a bright
 * dot, staggered from the pointer. The leaning tile is straightened as far as
 * it will go, and its dot stays medium: checked, not clean. The slider is the
 * stagger between tiles.
 *
 * The pattern: one of many, with a tween per tile, a stagger by distance, and
 * hit bands that never move.
 */
const {
  Cam, clamp, facing, fillet, fit, poly, proj, prism, rad, rings, put, solid,
  tdone, tset, tval, tween, mk, place, pointer, register, disposer,
} = HL;

const N = 6, F = 3, TWD = 15, TH = 34, STEP = 20, X0 = 10, BAD = 22, FIXED = 7;
const xc = (i) => X0 + i * STEP;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 2.5);
  fit(C, [[-8, -8, -4], [128, -8, 0], [-8, 12, 0], [128, 12, 0], [xc(0), 0, TH + 10], [xc(N - 1), 0, TH + 10]], 200, 170);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const [rr, ri] = rings(-8, -8, 128, 12, 5, 1.4), rail = solid(g);
  put(rail, prism(P, front, rr, ri, -4, 0));

  const shape = fillet([[0, 0], [TWD, 0], [TWD, TH], [0, TH]], [1.2, 1.2, 4, 4]);
  const tiles = Array.from({ length: N }, (_, i) => {
    const grp = mk("g", {}, g);
    return {
      back: mk("path", { class: "lo" }, grp), face: mk("path", { class: "sil" }, grp), crease: mk("path", { class: "nf lo" }, grp),
      dot: mk("circle", { r: 2.4, class: "dot off" }, grp),
      th: tween(i === F ? BAD : 0), ck: tween(0), cls: "",
    };
  });
  tiles[F].face.classList.add("hi");

  /** Tile i turned th degrees about its foot, in the plane of its face. */
  function draw(i, th) {
    const t = tiles[i], s = Math.sin(rad(th)), c = Math.cos(rad(th));
    const w = (u, z, y) => P(xc(i) + (u - TWD / 2) * c + z * s, y, z * c - (u - TWD / 2) * s + (TWD / 2) * Math.abs(s));
    t.back.setAttribute("d", poly(shape.map((p) => w(p[0], p[1], 0))));
    t.face.setAttribute("d", poly(shape.map((p) => w(p[0], p[1], 3))));
    t.crease.setAttribute("d", poly(shape.map((p) => w(TWD / 2 + (p[0] - TWD / 2) * 0.62, 6 + (p[1] - 6) * 0.78, 3))));
    place(t.dot, w(TWD / 2, TH + 7, 1.5));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    tiles.forEach((t, i) => {
      draw(i, tval(t.th, now));
      const on = tval(t.ck, now) > 0.5, cls = on ? (i === F ? "dot m" : "dot") : "dot off";
      if (cls !== t.cls) { t.cls = cls; t.dot.setAttribute("class", cls); }
      if (!tdone(t.th, now) || !tdone(t.ck, now)) moving = true;
    });
    return moving;
  });
  bag.add(B.unregister);

  // hit bands from the resting row: nearest tile by screen x, within the row's height
  const cx = (i) => P(xc(i), 1.5, TH / 2)[0], half = Math.abs(cx(1) - cx(0)) / 2;
  const top = P(xc(0), 1.5, TH + 12)[1], bot = P(xc(N - 1), 1.5, -6)[1];
  function hit([x, y]) {
    if (y < top - 30 || y > bot + 30) return -1;
    const i = clamp(Math.round((x - cx(0)) / (2 * half)), 0, N - 1);
    return Math.abs(x - cx(i)) <= half * 1.25 ? i : -1;
  }

  let act = -2;
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act < 0 ? 0 : act;
    act = a;
    tiles.forEach((t, i) => {
      const d = Math.abs(i - from) * stag;
      tset(t.ck, a >= 0 && i <= a ? 1 : 0, now, d);
      if (i === F) tset(t.th, a >= F ? FIXED : BAD, now, d);
    });
    tiles[F].face.classList.toggle("hi", a < 0);
    read.textContent = a < 0 ? "rest" : "ok " + (a + 1 - (a >= F ? 1 : 0)) + "/" + N;
    B.wake();
  }
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "verify",
  means: "Six tiles in a rail, one leaning: the pointer checks along the row, and the leaning tile only straightens part of the way.",
  rules: [1, 2, 4, 8],
  range: [20, 45, 90],
  mount,
});
