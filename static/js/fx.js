// Partículas com física simples e "voos" em arco para os objetos que os personagens jogam.

const layer = document.getElementById("fx");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const P = [];
let raf = 0, lastT = 0;
const MAX = 260;

// ícones pixel minúsculos para partículas
const ICONS = {
  heart: [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."],
  spark: ["..#..", "..#..", "#####", "..#..", "..#.."],
  star:  ["...#...", "...#...", ".#####.", "#######", ".#####.", ".##.##.", "#.....#"],
};
function iconSVG(name) {
  const rows = ICONS[name];
  let r = "";
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" fill="currentColor">${r}</svg>`;
}

function tick(t) {
  const dt = lastT ? Math.min(3, (t - lastT) / 16.67) : 1;
  lastT = t;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    p.vy += p.g * dt;
    p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    p.life -= dt;
    p.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%) rotate(${p.r.toFixed(0)}deg)`;
    p.el.style.opacity = Math.min(1, p.life / 18).toFixed(2);
    if (p.life <= 0) { p.el.remove(); P.splice(i, 1); }
  }
  if (P.length) raf = requestAnimationFrame(tick);
  else { raf = 0; lastT = 0; }
}

/** Explosão de partículas: quadradinhos, letras (texto) ou ícones. */
export function burst(x, y, o = {}) {
  if (reduceMotion) return;
  const { n = 10, colors = ["#19d3ff"], chars = null, icon = null, speed = 4, spread = 360, dir = -90,
    gravity = 0.22, life = 50, size = 6, drag = 0.985, spin = 0 } = o;
  for (let k = 0; k < n && P.length < MAX; k++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    let el;
    if (chars) {
      el = document.createElement("span");
      el.className = "ch";
      el.textContent = chars[Math.floor(Math.random() * chars.length)]; // textContent: texto do OCR nunca vira HTML
      el.style.fontSize = size + "px";
    } else if (icon) {
      el = document.createElement("span");
      el.className = "ic";
      el.innerHTML = iconSVG(icon);
      el.style.width = el.style.height = size + "px";
    } else {
      el = document.createElement("span");
      el.className = "px";
      el.style.width = el.style.height = size + "px";
      el.style.background = color;
    }
    el.style.color = color;
    const a = ((dir + (Math.random() - 0.5) * spread) * Math.PI) / 180;
    const v = speed * (0.45 + Math.random() * 0.85);
    P.push({ el, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: gravity, drag, life: life * (0.7 + Math.random() * 0.6),
      r: 0, vr: (chars || icon) ? (Math.random() - 0.5) * spin : 0 });
    layer.append(el);
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

export function floater(content, cls) {
  const el = document.createElement("div");
  el.className = cls;
  if (typeof content === "string") el.innerHTML = content; // só HTML fixo do próprio código
  else el.append(content);
  layer.append(el);
  return el;
}

export function place(el, x, y, extra = "") {
  el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) ${extra}`;
}

export function center(target) {
  if (!target) return null;
  if ("x" in target && "y" in target && !(target instanceof Element)) return target;
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Voo em arco (bezier quadrática) de `from` até `to`. */
export async function flyArc(el, from, to, o = {}) {
  const { lift = 100, dur = 700, spin = 0, s0 = 1, s1 = 1, easing = "linear" } = o;
  if (reduceMotion) { place(el, to.x, to.y, `scale(${s1})`); return; }
  const cx = (from.x + to.x) / 2, cy = Math.min(from.y, to.y) - lift;
  const frames = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = u * u * from.x + 2 * u * t * cx + t * t * to.x;
    const y = u * u * from.y + 2 * u * t * cy + t * t * to.y;
    frames.push({ transform: `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${spin * t}deg) scale(${s0 + (s1 - s0) * t})` });
  }
  const anim = el.animate(frames, { duration: dur, easing, fill: "forwards" });
  try { await anim.finished; } catch { return; }
  try { anim.commitStyles(); } catch { /* elemento já removido */ }
  anim.cancel();
}

/** Texto curto que sobe e some (ex.: "+1 DOWNLOAD"). */
export function flash(text, x, y, color = "#ffe94d") {
  const el = document.createElement("span");
  el.className = "flash";
  el.textContent = text;
  el.style.color = color;
  layer.append(el);
  const kf = [
    { transform: `translate(${x}px,${y}px) translate(-50%,-50%) scale(.6)`, opacity: 0 },
    { transform: `translate(${x}px,${y - 14}px) translate(-50%,-50%) scale(1.1)`, opacity: 1, offset: 0.2 },
    { transform: `translate(${x}px,${y - 44}px) translate(-50%,-50%) scale(1)`, opacity: 0 },
  ];
  el.animate(kf, { duration: reduceMotion ? 1 : 1100, easing: "ease-out" }).finished.finally(() => el.remove());
}

export function fileIcon(kind) {
  const MAP = [
    "#######   ",
    "#.....##  ",
    "#.....#.# ",
    "#.....####",
    "#........#",
    "#.------.#",
    "#........#",
    "#.------.#",
    "#........#",
    "#.----...#",
    "#........#",
    "##########",
  ];
  let r = "";
  MAP.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === "#") r += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>`;
    else if (c === ".") r += `<rect x="${x}" y="${y}" width="1" height="1" fill="#0a061c"/>`;
    else if (c === "-") r += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor" opacity=".55"/>`;
  }));
  return `<svg viewBox="0 0 10 12">${r}</svg><b>.${kind.toUpperCase()}</b>`;
}
