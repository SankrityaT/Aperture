/**
 * Compile: five loose plates float apart, each an action found on a page. The
 * pointer's position along the ground draws them together, and they settle
 * into one stack, a single tool. The top plate holds the bright edge. The
 * slider is how far the pointer must travel to finish the stack.
 *
 * The pattern: a field with one spring for the whole gather, every plate
 * interpolating between its loose pose and its place in the stack.
 */
const {
  Cam, clamp, facing, fit, lerp, proj, prism, rings, put, solid, spring, stepS, unproj,
  mk, pointer, register, disposer,
} = HL;

const N = 5, PW = 40, PD = 28, PT = 6, REST = 0.14;
// loose pose: centre x, y and height; the stack stands at (60, 42)
const LOOSE = [[22, 14, 40], [96, 22, 8], [30, 70, 18], [92, 74, 52], [60, 44, 74]];
const SX = 60, SY = 42, X0 = 4;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value;

  const C = Cam(45, 0.5, 2.0);
  fit(C, [[-8, -8, -4], [128, -8, 0], [-8, 92, 0], [128, 92, 0], [60, 42, 80], [22, 14, 80]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const [br, bi] = rings(-8, -8, 128, 92, 6, 1.4), base = solid(g);
  put(base, prism(P, front, br, bi, -4, 0));

  const plates = LOOSE.map((l, i) => ({ l, el: solid(g), drawn: NaN, top: i === N - 1 }));
  plates[N - 1].el.sil.classList.add("hi");

  const sp = spring(REST, { eps: 0.002 });
  let over = false, lit = -1, order = "", drawn = NaN;

  function draw() {
    const c = sp.x, pose = plates.map((p, i) => {
      const e = clamp(c * 1.25 - i * 0.07, 0, 1), t = e * e * (3 - 2 * e);
      return { x: lerp(p.l[0], SX, t), y: lerp(p.l[1], SY, t), z: lerp(p.l[2], 1 + i * (PT + 1.2), t) };
    });
    plates.forEach((p, i) => {
      const q = pose[i], key = q.x + q.y + 0.8 * q.z, [r, ri] = rings(q.x - PW / 2, q.y - PD / 2, q.x + PW / 2, q.y + PD / 2, 4, 1.1);
      p.key = key;
      put(p.el, prism(P, front, r, ri, q.z, q.z + PT));
    });
    const o = plates.map((p, i) => [p.key, i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]).join();
    if (o !== order) { order = o; o.split(",").forEach((i) => g.appendChild(plates[i].el.g)); }
  }

  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    if (sp.x !== drawn) { drawn = sp.x; draw(); }
    return m;
  });
  bag.add(B.unregister);

  function aim(x) {
    over = x !== null;
    sp.t = over ? clamp((x - X0) / reach, 0, 1) : REST;
    if (over) { const k = Math.round(sp.t * N); if (k !== lit) { lit = k; read.textContent = "joined " + k; } } else { lit = -1; read.textContent = "rest"; }
    B.wake();
  }
  bag.add(pointer(stage, { move: (p) => aim(unproj(C, p[0], p[1], 0)[0]), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { reach = v; if (over) B.wake(); }, destroy: bag.dispose };
}

hairline({
  name: "compile",
  means: "Five loose plates drift together as the pointer travels, and settle into one stack: separate actions, one tool.",
  rules: [1, 3, 4, 8],
  range: [60, 90, 130],
  mount,
});
