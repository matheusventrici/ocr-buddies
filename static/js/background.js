// Fundo pixelado: desenha numa resolução 4x menor e o CSS amplia com
// image-rendering: pixelated. Fica com cara de pixel art e custa 16x menos pixels por frame.

const PX = 4;
const SKY = [[4, 1, 14], [9, 3, 28], [20, 5, 48], [40, 8, 70], [76, 12, 96], [120, 20, 110]];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // dithering 4x4

export function createBackground(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, horizon = 0, span = 0, sky = null;
  let stars = [], packets = [], drops = [];
  let mode = "normal";
  let vp = 0.5, vpTarget = 0.5, last = 0;
  const samples = [];

  function renderSky() {
    // Céu, sol e névoa são estáticos: renderizados uma vez por resize, pixel a pixel, com dithering.
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H), d = img.data;
    const sunR = Math.round(Math.min(W * 0.15, H * 0.26)), sunX = Math.round(W / 2);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const th = BAYER[(y & 3) * 4 + (x & 3)] + 0.5;
        let r, gg, b;
        if (y < horizon) {
          const f = Math.pow(y / horizon, 1.5) * (SKY.length - 1);
          let k = Math.floor(f);
          if ((f - k) * 16 > th) k = Math.min(k + 1, SKY.length - 1);
          [r, gg, b] = SKY[k];
          const dx = x - sunX, dy = y - horizon;
          if (dx * dx + dy * dy <= sunR * sunR) {
            const v = (y - (horizon - sunR)) / sunR; // 0 no topo do sol, 1 no horizonte
            const gap = v > 0.45 ? Math.floor((v - 0.45) * 9) + 1 : 0;
            if (!(gap && (horizon - y) % 6 < gap)) {
              const a = 0.5;
              r = r * (1 - a) + 255 * a;
              gg = gg * (1 - a) + (233 - 190 * v) * a;
              b = b * (1 - a) + (77 + 137 * v) * a;
            }
          }
        } else {
          const v = (y - horizon) / span;
          let h = Math.max(0, 1 - v * 3.2);
          h = h * h;
          if (h * 16 > th && h < 0.9) h += 0.08;
          r = 5 + 80 * h; gg = 1 + 6 * h; b = 14 + 80 * h;
        }
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: c, sunR, sunX };
  }

  function makeStars() {
    const out = [], n = Math.floor((W * horizon) / 240);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * horizon * 0.88);
      const dx = x - sky.sunX, dy = y - horizon;
      if (dx * dx + dy * dy < (sky.sunR + 3) ** 2) continue;
      out.push({ x, y, p: Math.random() * 6.28, s: 0.0008 + Math.random() * 0.002, c: Math.random() < 0.25 ? "#19d3ff" : "#e9f4ff", big: Math.random() < 0.08 });
    }
    return out;
  }

  function initDrops() {
    drops = [];
    for (let x = 0; x < W; x += 2) {
      if (Math.random() < 0.55) drops.push({ x, y: Math.random() * -H, sp: 0.6 + Math.random() * 1.4, len: 6 + Math.floor(Math.random() * 14) });
    }
  }

  function resize() {
    W = Math.ceil(innerWidth / PX);
    H = Math.ceil(innerHeight / PX);
    canvas.width = W; canvas.height = H;
    canvas.style.width = W * PX + "px"; // escala inteira: todo "pixel" tem exatamente 4x4
    canvas.style.height = H * PX + "px";
    horizon = Math.round(H * 0.6);
    span = H - horizon;
    sky = renderSky();
    stars = makeStars();
    packets = [];
    if (mode === "matrix") initDrops();
    draw(performance.now(), 1);
  }

  function draw(t, dt) {
    const party = mode === "party";
    const hue = party ? (t / 6) % 360 : 312;
    ctx.filter = party ? `hue-rotate(${(t / 8) % 360}deg)` : "none";
    ctx.drawImage(sky.canvas, 0, 0);
    ctx.filter = "none";

    // estrelas piscando (alfa quantizado para manter o look 8-bit)
    for (const s of stars) {
      const a = Math.abs(Math.sin(t * s.s + s.p));
      if (a < 0.25) continue;
      ctx.globalAlpha = a > 0.8 ? 1 : a > 0.5 ? 0.6 : 0.3;
      ctx.fillStyle = party ? `hsl(${(hue + s.x * 3) % 360},100%,70%)` : s.c;
      ctx.fillRect(s.x, s.y, 1, 1);
      if (s.big && a > 0.8) {
        ctx.globalAlpha = 0.5;
        ctx.fillRect(s.x - 1, s.y, 1, 1); ctx.fillRect(s.x + 1, s.y, 1, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 1); ctx.fillRect(s.x, s.y + 1, 1, 1);
      }
    }
    ctx.globalAlpha = 1;

    // grade em perspectiva (chão synthwave), ponto de fuga segue o mouse
    vp += (vpTarget - vp) * Math.min(1, 0.06 * dt);
    const vpx = W * vp, nearSp = W / 9;
    const off = (t * 0.00045) % 1;
    for (let k = 0; k < 24; k++) {
      const z = k + 1 - off;
      if (z < 0.6) continue;
      const y = Math.round(horizon + span / z);
      if (y >= H) continue;
      const a = Math.min(1, 1.6 / z);
      ctx.fillStyle = `hsla(${hue},100%,${45 + 20 * a}%,${0.25 + 0.75 * a})`;
      ctx.fillRect(0, y, W, 1);
    }
    ctx.fillStyle = `hsla(${hue},100%,62%,.85)`;
    for (let i = -14; i <= 14; i++) {
      let px = Math.round(vpx);
      for (let y = horizon + 1; y < H; y++) {
        const x = Math.round(vpx + (i * nearSp * (y - horizon)) / span);
        const lo = Math.min(px, x), w = Math.abs(x - px) + 1;
        if (lo < W && lo + w > 0) ctx.fillRect(lo, y, w, 1);
        px = x;
      }
    }
    const fade = ctx.createLinearGradient(0, horizon, 0, horizon + span * 0.35);
    fade.addColorStop(0, "rgba(40,4,60,.92)");
    fade.addColorStop(1, "rgba(5,1,14,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, horizon, W, Math.ceil(span * 0.35));
    ctx.fillStyle = `hsl(${hue},100%,72%)`;
    ctx.fillRect(0, horizon, W, 1);

    // "pacotes de dados" correndo pelas linhas da grade
    if (packets.length < 10 && Math.random() < 0.06 * dt) {
      packets.push({ i: Math.floor(Math.random() * 25) - 12, z: 16, sp: 0.012 + Math.random() * 0.02, c: Math.random() < 0.7 ? "#19d3ff" : "#ffe94d" });
    }
    for (let n = packets.length - 1; n >= 0; n--) {
      const p = packets[n];
      p.z -= p.sp * p.z * dt;
      const y = Math.round(horizon + span / p.z);
      if (y >= H || p.z <= 0.2) { packets.splice(n, 1); continue; }
      const x = Math.round(vpx + (p.i * nearSp * (y - horizon)) / span);
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x, y - 1, 1, 1);
      ctx.globalAlpha = 1;
    }

    // easter egg: chuva estilo matrix
    if (mode === "matrix") {
      ctx.fillStyle = "rgba(0,8,2,.84)";
      ctx.fillRect(0, 0, W, H);
      for (const d of drops) {
        d.y += d.sp * dt;
        if (d.y - d.len > H) { d.y = Math.random() * -20; d.sp = 0.6 + Math.random() * 1.4; }
        const hy = Math.floor(d.y);
        for (let j = 1; j < d.len; j++) {
          ctx.fillStyle = `rgba(57,255,136,${(1 - j / d.len) * 0.8})`;
          ctx.fillRect(d.x, hy - j, 1, 1);
        }
        ctx.fillStyle = "#d6ffe4";
        ctx.fillRect(d.x, hy, 1, 1);
      }
    }
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (document.hidden || t - last < 33) return; // ~30 fps já basta pro fundo
    const dt = last ? Math.min(4, (t - last) / 16.7) : 1;
    last = t;
    const s = performance.now();
    draw(t, dt);
    samples.push(performance.now() - s);
    if (samples.length > 240) samples.shift();
  }

  addEventListener("pointermove", (e) => { vpTarget = 0.5 + (e.clientX / innerWidth - 0.5) * 0.3; }, { passive: true });
  let rt = 0;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
  resize();
  if (!reduceMotion) requestAnimationFrame(loop);

  return {
    setMode(m) {
      mode = m;
      if (m === "matrix") initDrops();
      if (reduceMotion) draw(performance.now(), 1);
    },
    get mode() { return mode; },
    stats() {
      const a = [...samples].sort((x, y) => x - y);
      if (!a.length) return null;
      return { frames: a.length, avgMs: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2), p95Ms: +a[Math.floor(a.length * 0.95)].toFixed(2), canvas: `${W}x${H}` };
    },
  };
}
