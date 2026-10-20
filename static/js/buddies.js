// Personagens em pixel art. Nenhuma imagem: cada sprite sai de uma "máscara" matemática
// (elipse, retângulo arredondado, cápsula) e o código calcula contorno, luz e sombra.

const OUT = "#120a24";
const key = (x, y) => x + "," + y;
const rect = (x, y, w, h) => { const a = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a.push([x + i, y + j]); return a; };
function rr(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

export const DEFS = {
  byte: {
    name: "BYTE", color: "#19d3ff", hi: "#a8f6ff", shade: "#0a86c2",
    body: (x, y) => ((x - 10) / 8.6) ** 2 + ((y - 12.8) / 8.1) ** 2 <= 1,
    extraBody: [[7, 21], [8, 21], [11, 21], [12, 21], [10, 4], [10, 3], [11, 2], [12, 2]],
    eyes: [{ x: 4, y: 9, s: 4, side: "L" }, { x: 12, y: 9, s: 4, side: "R" }],
    mouth: { x: 10, y: 15 }, cheeks: [[3, 14], [4, 14], [15, 14], [16, 14]],
    eyeWhite: "#f4fbff", eyeInk: OUT, mouthInk: OUT, mouthIn: "#ff3b6b", teeth: "#f4fbff",
  },
  pixel: {
    name: "PIXEL", color: "#ff2bd6", hi: "#ff9df0", shade: "#a1168a",
    body: (x, y) => rr(x, y, 2, 6, 18, 21, 2.2),
    extraBody: [[4, 21], [5, 21], [6, 21], [13, 21], [14, 21], [15, 21]],
    parts: [
      { color: "#ffe94d", cells: rect(8, 1, 4, 2), cls: "ant" },
      { color: "#c9b8ff", cells: rect(9, 3, 2, 3) },
      { color: "#8a7fd0", cells: [...rect(0, 11, 2, 3), ...rect(18, 11, 2, 3)] },
      { color: "#1a0a2e", cells: rect(4, 9, 12, 10).filter(([x, y]) => !((x === 4 || x === 15) && (y === 9 || y === 18))) },
    ],
    eyes: [{ x: 5, y: 10, s: 4, side: "L" }, { x: 11, y: 10, s: 4, side: "R" }],
    mouth: { x: 10, y: 15 }, cheeks: [],
    eyeWhite: "#2b1552", eyeInk: "#19d3ff", mouthInk: "#19d3ff", mouthIn: "#0e3d52", teeth: "#19d3ff",
  },
  glitch: {
    name: "GLITCH", color: "#39ff88", hi: "#c6ffdc", shade: "#13a052",
    body: (x, y) => rr(x, y, 5, 3, 15, 21, 5),
    extraBody: [[7, 21], [8, 21], [11, 21], [12, 21], [6, 2], [13, 2]],
    parts: [{ color: "#eaff5c", cells: [[5, 1], [14, 1]] }],
    eyes: [{ x: 7, y: 7, s: 6, side: "C" }],
    mouth: { x: 10, y: 15 }, cheeks: [[6, 13], [13, 13]],
    eyeWhite: "#f4fbff", eyeInk: OUT, mouthInk: OUT, mouthIn: "#ff3b6b", teeth: "#f4fbff",
  },
};

const MOUTHS = {
  smile: ["k....k", ".kkkk."],
  flat: [".kkkk."],
  open: ["kkkkkk", "krrrrk", ".kkkk."],
  big: ["kkkkkk", "kwwwwk", "krrrrk", "krrrrk", ".kkkk."],
  o: ["..kk..", ".krrk.", "..kk.."],
  frown: [".kkkk.", "k....k"],
  zig: ["k.k.k.", ".k.k.k"],
  sleep: ["..kk.."],
  cat: ["k.kk.k", ".k..k."],
};

export const MOOD_FACE = {
  idle: { eyes: "open", mouth: "smile" },
  reading: { eyes: "open", mouth: "flat" },
  happy: { eyes: "happy", mouth: "open" },
  table: { eyes: "happy", mouth: "open" },
  empty: { eyes: "open", mouth: "frown" },
  error: { eyes: "tiny", mouth: "zig" },
  sleep: { eyes: "closed", mouth: "sleep" },
  party: { eyes: "happy", mouth: "cat" },
};

function rects(color, cells, attrs = "") {
  const rows = new Map();
  for (const [x, y] of cells) { if (!rows.has(y)) rows.set(y, new Set()); rows.get(y).add(x); }
  let s = "";
  for (const [y, set] of rows) {
    const xs = [...set].sort((a, b) => a - b);
    let start = xs[0], prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === prev + 1) { prev = x; continue; }
      s += `<rect x="${start}" y="${y}" width="${prev - start + 1}" height="1"/>`; // junta pixels vizinhos num retângulo só
      start = prev = x;
    }
  }
  return `<g fill="${color}"${attrs}>${s}</g>`;
}

function buildSprite(d) {
  const body = new Map();
  for (let y = 0; y < 22; y++) for (let x = 0; x < 20; x++) if (d.body(x + 0.5, y + 0.5)) body.set(key(x, y), [x, y]);
  for (const [x, y] of d.extraBody || []) body.set(key(x, y), [x, y]);
  const solid = new Set(body.keys());
  for (const p of d.parts || []) for (const [x, y] of p.cells) solid.add(key(x, y));

  const outline = [];
  for (let y = -1; y <= 22; y++) for (let x = -1; x <= 20; x++) {
    if (solid.has(key(x, y))) continue;
    if (solid.has(key(x + 1, y)) || solid.has(key(x - 1, y)) || solid.has(key(x, y + 1)) || solid.has(key(x, y - 1))) outline.push([x, y]);
  }

  const cells = [...body.values()];
  const ys = cells.map((c) => c[1]), xs = cells.map((c) => c[0]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (minY + maxY) / 2;
  const top = Math.min(...[...solid].map((k) => +k.split(",")[1]));

  const layers = new Map([[d.color, []], [d.hi, []], [d.shade, []]]);
  for (const [x, y] of cells) {
    const up = !solid.has(key(x, y - 1)), left = !solid.has(key(x - 1, y));
    const down = !solid.has(key(x, y + 1)), right = !solid.has(key(x + 1, y));
    let c = d.color;
    if ((up || left) && y < cy && x < cx + 2) c = d.hi;            // luz de borda em cima/esquerda
    else if ((down || right) && y > cy - 1) c = d.shade;          // sombra de borda embaixo/direita
    else if (y > cy + (maxY - cy) * 0.45 && (x + y) % 2 === 0) c = d.shade; // sombra pontilhada (dithering)
    layers.get(c).push([x, y]);
  }

  let svg = rects(OUT, outline);
  for (const [c, cs] of layers) svg += rects(c, cs);
  for (const p of d.parts || []) svg += rects(p.color, p.cells, p.cls ? ` class="${p.cls}"` : "");
  if (d.cheeks.length) svg += rects("#ff6b9d", d.cheeks, ' opacity=".75"');
  return { svg, top };
}

function eyeSVG(e, mode, d) {
  const s = e.s, ink = d.eyeInk;
  const at = (cells, color, attrs = "") => rects(color, cells.map(([x, y]) => [e.x + x, e.y + y]), attrs);
  if (mode === "happy") {
    const c = s === 4 ? [[0, 2], [1, 1], [2, 1], [3, 2]] : [[0, 3], [1, 2], [2, 1], [3, 1], [4, 2], [5, 3]];
    return at(c, ink);
  }
  if (mode === "closed") {
    const y = Math.floor(s / 2);
    return at(Array.from({ length: s }, (_, i) => [i, y]), ink);
  }
  const corner = (x, y) => {
    const ex = x === 0 || x === s - 1, ey = y === 0 || y === s - 1;
    if (s === 4) return ex && ey;
    return (ex && ey) || (ex && (y === 1 || y === s - 2)) || (ey && (x === 1 || x === s - 2));
  };
  const white = [];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (!corner(x, y)) white.push([x, y]);
  let out = at(white, d.eyeWhite);
  if (mode === "angry") {
    const brow = e.side === "L" ? [[0, -2], [1, -2], [2, -1], [3, -1]]
      : e.side === "R" ? [[0, -1], [1, -1], [2, -2], [3, -2]]
      : [[0, -2], [1, -2], [2, -1], [3, -1], [4, -2], [5, -2]];
    out += at(brow, ink);
  }
  const p = mode === "tiny" ? 1 : 2;
  out += `<rect class="pupil" width="${p}" height="${p}" fill="${ink}" x="0" y="0"/>`;
  return out;
}

function mouthSVG(d, name) {
  const pat = MOUTHS[name] || MOUTHS.smile;
  const w = pat[0].length;
  const x0 = d.mouth.x - w / 2, y0 = d.mouth.y - Math.max(0, Math.floor((pat.length - 2) / 2));
  const by = { k: [], r: [], w: [] };
  pat.forEach((row, y) => [...row].forEach((c, x) => { if (by[c]) by[c].push([x0 + x, y0 + y]); }));
  return rects(d.mouthIn, by.r) + rects(d.teeth, by.w) + rects(d.mouthInk, by.k);
}

export class Buddy {
  constructor(id) {
    this.id = id;
    this.d = DEFS[id];
    this.face = { eyes: "open", mouth: "smile" };
    this.busy = false;
    this.clicks = [];
    this.blinking = false;
    const { svg, top } = buildSprite(this.d);
    this.top = top;
    const el = document.createElement("button");
    el.type = "button";
    el.className = `buddy buddy-${id}`;
    el.setAttribute("aria-label", `${this.d.name}: clique para interagir`);
    el.innerHTML = `<span class="rig"><span class="bob"><svg viewBox="-1 -1 22 24" aria-hidden="true">${svg}<g class="eyes"></g><g class="mouth"></g></svg></span></span><span class="tag">${this.d.name}</span>`;
    this.el = el;
    this.rig = el.querySelector(".rig");
    this.svg = el.querySelector("svg");
    this.eyesG = el.querySelector(".eyes");
    this.mouthG = el.querySelector(".mouth");
    this.look = this.d.eyes.map(() => ({ dx: 0, dy: 0 }));
    this.render();
  }

  setFace(f) {
    this.blinking = false;
    const nf = { ...this.face, ...f };
    if (nf.eyes === this.face.eyes && nf.mouth === this.face.mouth) return;
    const eyesChanged = nf.eyes !== this.face.eyes;
    this.face = nf;
    if (eyesChanged) this.renderEyes();
    this.mouthG.innerHTML = mouthSVG(this.d, this.face.mouth);
  }

  render() { this.renderEyes(); this.mouthG.innerHTML = mouthSVG(this.d, this.face.mouth); }

  renderEyes() {
    this.eyesG.innerHTML = this.d.eyes.map((e) => `<g>${eyeSVG(e, this.face.eyes, this.d)}</g>`).join("");
    this.pupils = [...this.eyesG.children].map((g) => g.querySelector(".pupil"));
    this.look.forEach((l) => { l.dx = l.dy = null; });
  }

  /** Move a pupila em passos inteiros de pixel (é isso que dá o ar 8-bit ao olhar). */
  setLook(i, dx, dy) {
    const pupil = this.pupils[i];
    if (!pupil) return;
    const l = this.look[i];
    if (l.dx === dx && l.dy === dy) return;
    l.dx = dx; l.dy = dy;
    const e = this.d.eyes[i], p = +pupil.getAttribute("width");
    const base = Math.floor((e.s - p) / 2);
    pupil.setAttribute("x", e.x + base + dx);
    pupil.setAttribute("y", e.y + base + dy);
  }

  moveRange(i) {
    const pupil = this.pupils[i];
    if (!pupil) return 0;
    return Math.floor((this.d.eyes[i].s - +pupil.getAttribute("width")) / 2);
  }

  /** Converte coordenada do sprite (unidades do viewBox) para coordenada de tela. */
  point(ux, uy) {
    const r = this.svg.getBoundingClientRect(), sc = r.width / 22;
    return { x: r.left + (ux + 1) * sc, y: r.top + (uy + 1) * sc };
  }
  headPoint() { return this.point(10, this.top - 2.5); }
  mouthPoint() { return this.point(this.d.mouth.x, this.d.mouth.y + 1); }
}

export class Crew {
  constructor(container, { reduceMotion = false } = {}) {
    this.el = container;
    this.reduceMotion = reduceMotion;
    this.list = ["byte", "pixel", "glitch"].map((id) => new Buddy(id));
    this.by = Object.fromEntries(this.list.map((b) => [b.id, b]));
    this.list.forEach((b) => { container.append(b.el); b.el.addEventListener("click", () => this.onClick?.(b)); });
    this.mood = "idle";
    this.target = null;   // elemento ou ponto que todos olham (sobrepõe o mouse)
    this.sweep = false;   // modo "lendo": olhos varrem como quem lê uma linha
    this.mouse = { x: innerWidth / 2, y: innerHeight * 0.8 };
    addEventListener("pointermove", (e) => { this.mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
    this.list.forEach((b) => this.scheduleBlink(b));
    const loop = (t) => { requestAnimationFrame(loop); if (!document.hidden) this.tick(t); };
    requestAnimationFrame(loop);
  }

  setMood(m, { force = false } = {}) {
    this.mood = m;
    this.sweep = m === "reading";
    for (const b of this.list) if (force || !b.busy) b.setFace(MOOD_FACE[m] || MOOD_FACE.idle);
  }

  restore(b) { b.setFace(MOOD_FACE[this.mood] || MOOD_FACE.idle); }

  scheduleBlink(b) {
    setTimeout(() => {
      if (b.face.eyes === "open" && !this.sweep && this.mood !== "sleep") {
        b.setFace({ eyes: "closed" });
        b.blinking = true;
        setTimeout(() => { if (b.blinking && b.face.eyes === "closed") b.setFace({ eyes: "open" }); b.blinking = false; }, 120);
      }
      this.scheduleBlink(b);
    }, 2200 + Math.random() * 4200);
  }

  tick(t) {
    let target = null;
    if (this.target) {
      if (this.target instanceof Element) {
        if (this.target.isConnected) { const r = this.target.getBoundingClientRect(); target = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      } else target = this.target;
    }
    target = target || this.mouse;
    for (const b of this.list) {
      if (!b.pupils.some(Boolean)) continue;
      const r = b.svg.getBoundingClientRect(), sc = r.width / 22;
      b.d.eyes.forEach((e, i) => {
        const m = b.moveRange(i);
        let dx = 0, dy = 0;
        if (this.sweep && !this.target) {
          const n = 2 * m + 3, st = Math.floor(t / 120) % n;
          dx = st <= 2 * m ? st - m : st === n - 1 ? -m : m;
          dy = Math.min(1, m);
        } else {
          const ex = r.left + (e.x + 1 + e.s / 2) * sc, ey = r.top + (e.y + 1 + e.s / 2) * sc;
          const vx = target.x - ex, vy = target.y - ey, dist = Math.hypot(vx, vy);
          if (dist > sc * 3) {
            dx = Math.max(-m, Math.min(m, Math.round((vx / dist) * m * 1.2)));
            dy = Math.max(-m, Math.min(m, Math.round((vy / dist) * m * 1.2)));
          }
        }
        b.setLook(i, dx, dy);
      });
    }
  }
}
