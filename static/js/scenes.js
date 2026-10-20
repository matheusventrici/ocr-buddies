// Coreografias: o que cada personagem faz em cada ação.

import * as fx from "./fx.js";
import { sound } from "./sound.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const run = (el, kf, opt) => el.animate(kf, opt).finished.catch(() => {});
const NEON = ["#19d3ff", "#ff2bd6", "#39ff88", "#ffe94d"];
const IDLE_MS = 45000;

const SQUASH = [{ transform: "scale(1,1)" }, { transform: "scale(1.16,.84)" }, { transform: "scale(1,1)" }];
const JELLY = [[1, 1], [1.25, 0.8], [0.85, 1.15], [1.1, 0.92], [0.96, 1.04], [1, 1]].map(([x, y]) => ({ transform: `scale(${x},${y})` }));
const hopKF = (h) => [{ transform: "translateY(0)" }, { transform: `translateY(-${h}px)`, offset: 0.45 }, { transform: "translateY(0)" }];

const CLICK_LINES = {
  byte: ["oi! eu sou o BYTE.", "cócegas não! hihi", "ler é comigo.", "8 bits de pura alegria.", "me dá um print, vai."],
  pixel: ["BEEP BOOP.", "sistema operacional: feliz.", "processando carinho...", "não aperta meu botão vermelho.", "meu visor é 100% LED."],
  glitch: ["eu não sou um bug. eu acho.", "01101111 01101001", "teleporte em 3... 2...", "eu vejo pixels.", "tô no frame errado?"],
};
const RAGE_LINES = ["PARA DE ME CUTUCAR!", "JÁ CHEGA DE CLIQUE!", "EU TENHO SENTIMENTOS. 8 BITS DELES!"];

export class Scenes {
  constructor({ crew, bg, reduceMotion, term, sr, stage }) {
    Object.assign(this, { crew, bg, reduceMotion, term, sr, stage });
    this.whoEl = term.querySelector(".who");
    this.txtEl = term.querySelector(".txt");
    this.mode = null;          // "party" | "matrix"
    this.sleeping = false;
    this.lastActive = performance.now();
    this.dragging = false;
    crew.onClick = (b) => this.click(b);
    setInterval(() => this.checkIdle(), 1000);
  }

  /* ---------- fala ---------- */
  say(who, text) {
    const b = this.crew.by[who];
    this.whoEl.textContent = (b ? b.d.name : who.toUpperCase()) + ">";
    this.whoEl.style.color = b ? b.d.color : "var(--yel)";
    this.sr.textContent = `${b ? b.d.name : who}: ${text}`; // leitor de tela recebe a frase inteira de uma vez
    clearInterval(this.typing);
    if (this.reduceMotion) { this.txtEl.textContent = text; return; }
    const chars = [...text];
    let i = 0;
    this.txtEl.textContent = "";
    this.typing = setInterval(() => {
      this.txtEl.textContent += chars[i++] ?? "";
      if (i >= chars.length) clearInterval(this.typing);
    }, 18);
  }

  claim(...bs) { if (bs.some((b) => b.busy)) return false; bs.forEach((b) => { b.busy = true; }); return true; }
  release(...bs) {
    bs.forEach((b) => {
      b.busy = false;
      this.crew.restore(b);
      if (b.rageNext) { b.rageNext = false; setTimeout(() => this.rage(b), 0); }
    });
  }
  allIdle() { return this.crew.list.every((b) => !b.busy); }

  /* ---------- colar / enviar imagem: PIXEL engole o print ---------- */
  async eatImage(src, fromEl) {
    const { crew } = this;
    const eater = crew.by.pixel, others = [crew.by.byte, crew.by.glitch];
    crew.list.forEach((b) => { b.busy = true; });
    eater.setFace({ eyes: "tiny", mouth: "big" });
    others.forEach((b) => b.setFace({ eyes: "tiny", mouth: "o" }));
    this.say("pixel", "NHAC! deixa comigo.");
    sound.play("hungry");
    const img = document.createElement("img");
    img.src = src; img.alt = "";
    const thumb = fx.floater(img, "thumb");
    try {
      const from = fx.center(fromEl);
      fx.place(thumb, from.x, from.y);
      crew.target = thumb;
      await fx.flyArc(thumb, from, eater.mouthPoint(), { lift: 70, dur: 650, spin: 360, s1: 0.1, easing: "cubic-bezier(.5,-0.2,.7,1)" });
      thumb.remove();
      crew.target = null;
      sound.play("chomp");
      const mp = eater.mouthPoint();
      for (let i = 0; i < 3; i++) {
        eater.setFace({ eyes: "happy", mouth: "flat" });
        run(eater.rig, SQUASH, { duration: 120 });
        fx.burst(mp.x, mp.y, { n: 4, colors: NEON, speed: 3.5, size: 5, life: 30 });
        await wait(this.reduceMotion ? 0 : 120);
        eater.setFace({ eyes: "happy", mouth: "big" });
        await wait(this.reduceMotion ? 0 : 90);
      }
      sound.play("gulp");
      eater.setFace({ eyes: "tiny", mouth: "smile" });
    } finally {
      thumb.remove();
      if (crew.target === thumb) crew.target = null;
      crew.list.forEach((b) => { b.busy = false; });
    }
  }

  startReading() {
    this.crew.setMood("reading");
    this.say(pick(["byte", "glitch"]), pick(["lendo... linha por linha.", "deixa eu ver de perto...", "decodificando pixels..."]));
    clearInterval(this.blips);
    this.blips = setInterval(() => sound.play("blip"), 140);
  }
  stopReading() { clearInterval(this.blips); }

  relax(ms) {
    clearTimeout(this.relaxT);
    this.relaxT = setTimeout(() => { if (["happy", "table", "empty", "error"].includes(this.crew.mood)) this.crew.setMood("idle"); }, ms);
  }

  hopAll(h = 18) {
    this.crew.list.forEach((b, i) => setTimeout(() => run(b.rig, hopKF(h), { duration: 420, easing: "ease-out", iterations: 2 }), i * 110));
  }

  reactResult(data, previewEl) {
    const r = previewEl.getBoundingClientRect();
    const ox = r.left + r.width / 2, oy = Math.max(40, r.top + 30);
    const chars = data.text.replace(/\s+/g, "").slice(0, 60) || "OCR";
    if (data.kind === "table") {
      const rows = data.table.length, cols = data.table[0]?.length || 0;
      this.crew.setMood("table");
      sound.play("table");
      this.say("byte", `tabela! ${rows} linhas x ${cols} colunas. dá pra baixar em excel.`);
      this.hopAll(20);
      fx.burst(ox, oy, { n: 26, chars, colors: NEON, speed: 7, size: 22, life: 70, spin: 12 });
      this.relax(2800);
    } else if (data.kind === "text") {
      const lines = data.text.split("\n").filter((l) => l.trim()).length;
      this.crew.setMood("happy");
      sound.play("success");
      this.say("glitch", `li ${lines} ${lines === 1 ? "linha" : "linhas"}. confere aí.`);
      this.hopAll(16);
      fx.burst(ox, oy, { n: 20, chars, colors: NEON, speed: 6, size: 22, life: 65, spin: 12 });
      this.relax(2600);
    } else {
      this.crew.setMood("empty");
      sound.play("empty");
      this.say("pixel", "não achei texto nessa imagem. tenta outro print?");
      this.crew.list.forEach((b) => run(b.rig, [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 300, iterations: 2 }));
      this.relax(3200);
    }
  }

  /** Depois do resultado: avisa sobre células em dúvida ou resgatadas e olha para elas. */
  reactMarks(data, firstMarked) {
    const flat = (m) => (m || []).flat().filter(Boolean).length;
    const doubts = flat(data.table_doubt) || (data.boxes || []).filter((b) => b.doubt).length;
    const rescued = flat(data.table_rescued);
    if (!doubts && !rescued) return;
    clearTimeout(this.marksT);
    this.marksT = setTimeout(() => {
      if (rescued) {
        sound.play("pick");
        const what = (data.boxes || []).find((b) => b.rescued)?.text;
        this.say("pixel", `achei ${what ? `um "${what}"` : "uma célula"} que tinha escapado da leitura!`);
      }
      if (doubts) {
        setTimeout(() => {
          sound.play("hungry");
          this.say("glitch", `marquei ${doubts} em amarelo: a gente não concordou. confere pra mim?`);
          if (firstMarked) {
            this.crew.target = firstMarked; // todo mundo olha pra célula duvidosa
            setTimeout(() => { if (this.crew.target === firstMarked) this.crew.target = null; }, 2500);
          }
        }, rescued ? 2400 : 0);
      }
    }, 2600);
  }

  error(msg) {
    this.crew.setMood("error");
    sound.play("error");
    this.say("glitch", "deu ruim: " + String(msg).slice(0, 90));
    this.crew.list.forEach((b) => { b.rig.classList.add("glitching"); setTimeout(() => b.rig.classList.remove("glitching"), 600); });
    this.relax(3600);
  }

  /* ---------- copiar: BYTE pega o texto e joga, GLITCH pula e pega ---------- */
  async copyToss(label, fromEl) {
    const { crew } = this;
    const thrower = crew.by.byte, catcher = crew.by.glitch;
    if (this.reduceMotion || !this.claim(thrower, catcher)) {
      sound.play("catch");
      this.say("glitch", "copiado! é só dar ctrl+v.");
      return;
    }
    const span = document.createElement("span");
    span.textContent = label;
    const chip = fx.floater(span, "chip-fly");
    try {
      const from = fx.center(fromEl) || thrower.headPoint();
      fx.place(chip, from.x, from.y);
      crew.target = chip;
      sound.play("pick");
      thrower.setFace({ eyes: "tiny", mouth: "o" });
      await fx.flyArc(chip, from, thrower.headPoint(), { lift: 120, dur: 520 });
      thrower.setFace({ eyes: "happy", mouth: "open" });
      this.say("byte", "peguei! GLITCH, lá vai!");
      await run(thrower.rig, SQUASH, { duration: 180 });
      sound.play("toss");
      catcher.setFace({ eyes: "tiny", mouth: "o" });
      const start = thrower.headPoint(), land = catcher.headPoint();
      const end = { x: land.x, y: land.y - 22 };
      const DUR = 900;
      setTimeout(() => run(catcher.rig, hopKF(26), { duration: 520, easing: "ease-out" }), DUR - 260);
      await fx.flyArc(chip, start, end, { lift: Math.max(150, start.y - 40), dur: DUR, spin: 720 });
      chip.remove();
      crew.target = null;
      sound.play("catch");
      fx.burst(end.x, end.y, { n: 18, chars: label.replace(/\s+/g, "") || "ctrl+v", colors: ["#ffe94d", "#39ff88", "#19d3ff"], speed: 5, size: 20, life: 55, spin: 10 });
      fx.flash("COPIADO!", end.x, end.y - 20, "#39ff88");
      catcher.setFace({ eyes: "happy", mouth: "open" });
      this.say("glitch", "peguei! tá no seu ctrl+v.");
      await wait(700);
    } finally {
      chip.remove();
      if (crew.target === chip) crew.target = null;
      this.release(thrower, catcher); // mesmo se algo falhar no meio, ninguém fica travado
    }
  }

  /* ---------- baixar: um personagem carrega o arquivo e arremessa ---------- */
  async downloadThrow(kind, filename, fromEl) {
    const carrierId = { txt: "byte", xlsx: "pixel", csv: "glitch" }[kind] || "byte";
    const b = this.crew.by[carrierId];
    if (this.reduceMotion || !this.claim(b)) {
      this.say(carrierId, `${filename} baixado!`);
      sound.play("whoosh");
      return;
    }
    const file = fx.floater(fx.fileIcon(kind), "file");
    file.style.color = b.d.color;
    let carrying = false;
    const timers = [];
    try {
      const from = fx.center(fromEl) || b.headPoint();
      fx.place(file, from.x, from.y);
      this.crew.target = file;
      sound.play("pick");
      await fx.flyArc(file, from, b.headPoint(), { lift: 110, dur: 480 });
      b.setFace({ eyes: "open", mouth: "open" });
      this.say(carrierId, pick([`deixa que eu levo o .${kind}!`, `entrega expressa de .${kind}!`, `segura que lá vai .${kind}!`]));

      // arquivo "colado" na cabeça enquanto ele corre
      carrying = true;
      const follow = () => { if (!carrying) return; const h = b.headPoint(); fx.place(file, h.x, h.y - 6); requestAnimationFrame(follow); };
      follow();
      const sr = this.stage.getBoundingClientRect(), br = b.el.getBoundingClientRect();
      // corre até a ponta direita do palco, passando pelo balão de fala sem parar em cima do texto
      const dx = Math.round(Math.max(40, sr.right - br.right - 6));
      const steps = setInterval(() => sound.play("step"), 130);
      timers.push(steps);
      b.rig.classList.add("walking");
      await run(b.el, [{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], { duration: Math.min(1500, dx * 2.4) });
      b.el.style.transform = `translateX(${dx}px)`; // posição explícita em vez de fill:"forwards" (que às vezes "grudava")
      b.rig.classList.remove("walking");
      clearInterval(steps);
      await run(b.rig, [{ transform: "rotate(0)" }, { transform: "rotate(-14deg) scale(1.05,.95)" }], { duration: 160 });
      carrying = false;
      sound.play("whoosh");
      this.crew.target = file;
      const p = fx.center(file), to = { x: innerWidth - 40, y: 22 }; // canto onde o navegador mostra os downloads
      const trail = setInterval(() => { const c = fx.center(file); fx.burst(c.x, c.y, { n: 2, colors: [b.d.color, "#ffffff"], speed: 1, size: 4, gravity: 0.05, life: 24 }); }, 35);
      timers.push(trail);
      run(b.rig, [{ transform: "rotate(-14deg)" }, { transform: "rotate(14deg)", offset: 0.4 }, { transform: "rotate(0)" }], { duration: 300 });
      await fx.flyArc(file, p, to, { lift: 70, dur: 700, spin: 900, s1: 0.35 });
      clearInterval(trail);
      file.remove();
      this.crew.target = null;
      fx.burst(to.x, to.y, { n: 14, icon: "star", colors: [b.d.color, "#ffe94d"], speed: 4, size: 12, life: 45, dir: 135, spread: 120 });
      fx.flash(`+1 ${filename}`, to.x - 70, to.y + 34, b.d.color);
      b.setFace({ eyes: "happy", mouth: "open" });
      this.say(carrierId, `${filename} entregue na sua pasta de downloads!`);
      b.rig.classList.add("walking");
      const steps2 = setInterval(() => sound.play("step"), 130);
      timers.push(steps2);
      b.el.style.transform = "";
      await run(b.el, [{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], { duration: Math.min(1500, dx * 2.4) });
    } finally {
      b.el.style.transform = "";
      carrying = false;
      timers.forEach(clearInterval);
      file.remove();
      if (this.crew.target === file) this.crew.target = null;
      b.rig.classList.remove("walking");
      b.el.getAnimations().forEach((a) => a.cancel());
      b.rig.getAnimations().forEach((a) => a.cancel());
      this.release(b);
    }
  }

  /* ---------- clique nos personagens ---------- */
  click(b) {
    this.activity();
    if (this.mode) return;
    // conta o clique mesmo com o personagem ocupado: quem cutuca rápido é justamente quem merece a bronca
    const now = performance.now();
    b.clicks = b.clicks.filter((t) => now - t < 2500);
    b.clicks.push(now);
    if (b.clicks.length >= 5) {
      b.clicks = [];
      if (b.busy) b.rageNext = true; else this.rage(b);
      return;
    }
    if (b.busy) return;
    ({ byte: this.jelly, pixel: this.spin, glitch: this.teleport })[b.id].call(this, b);
  }

  async jelly(b) {
    if (!this.claim(b)) return;
    b.setFace({ eyes: "happy", mouth: "open" });
    sound.play("boing");
    this.say("byte", pick(CLICK_LINES.byte));
    const h = b.headPoint();
    fx.burst(h.x, h.y, { n: 7, icon: "heart", colors: ["#ff6b9d", "#ff2bd6", "#ffe94d"], speed: 3.2, size: 14, gravity: -0.03, life: 60, spread: 90 });
    await run(b.rig, JELLY, { duration: 650 });
    this.release(b);
  }

  async spin(b) {
    if (!this.claim(b)) return;
    b.setFace({ eyes: "tiny", mouth: "o" });
    sound.play("beep");
    this.say("pixel", pick(CLICK_LINES.pixel));
    const h = b.headPoint();
    fx.burst(h.x, h.y + 6, { n: 10, icon: "spark", colors: ["#ffe94d", "#19d3ff"], speed: 5, size: 10, life: 35 });
    await run(b.rig, [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 640, easing: "steps(8, end)" });
    b.setFace({ eyes: "happy", mouth: "smile" });
    await wait(300);
    this.release(b);
  }

  async teleport(b) {
    if (!this.claim(b)) return;
    b.setFace({ eyes: "tiny", mouth: "zig" });
    sound.play("glitch");
    this.say("glitch", pick(CLICK_LINES.glitch));
    b.rig.classList.add("glitching");
    const jump = () => `translate(${Math.round(Math.random() * 30 - 15)}px, ${Math.round(Math.random() * -12)}px)`;
    await run(b.el, [{ transform: "translate(0,0)" }, { transform: jump() }, { transform: jump() }, { transform: jump() }, { transform: "translate(0,0)" }], { duration: 560, easing: "steps(5, end)" });
    b.rig.classList.remove("glitching");
    const c = fx.center(b.svg);
    fx.burst(c.x, c.y, { n: 12, colors: ["#39ff88", "#ff2bd6", "#19d3ff"], speed: 4, size: 6, life: 30 });
    this.release(b);
  }

  /* easter egg: cutucar 5x seguidas */
  async rage(b) {
    if (!this.claim(b)) return;
    b.el.classList.add("angry");
    b.setFace({ eyes: "angry", mouth: "zig" });
    sound.play("angry");
    this.say(b.id, pick(RAGE_LINES));
    const others = this.crew.list.filter((o) => o !== b && !o.busy);
    others.forEach((o) => o.setFace({ eyes: "tiny", mouth: "o" }));
    this.crew.target = b.el;
    const steam = setInterval(() => { const h = b.headPoint(); fx.burst(h.x, h.y + 4, { n: 2, colors: ["#ff3b6b", "#a39fd0"], speed: 2.4, size: 7, gravity: -0.04, life: 40, spread: 70 }); }, 90);
    await wait(2000);
    clearInterval(steam);
    b.el.classList.remove("angry");
    this.crew.target = null;
    others.forEach((o) => { if (!o.busy) this.crew.restore(o); });
    this.say(b.id, "tá. passou. respira...");
    this.release(b);
  }

  /* easter egg: código Konami */
  async party() {
    if (this.mode) return;
    if (!this.allIdle()) { this.say("glitch", "calma, termina aí primeiro."); return; }
    this.wakeIfSleeping();
    this.mode = "party";
    this.bg.setMode("party");
    this.crew.list.forEach((b) => { b.busy = true; });
    this.crew.setMood("party", { force: true });
    this.crew.list.forEach((b, i) => { b.rig.style.animationDelay = `${-i * 0.15}s`; b.rig.classList.add("dance"); });
    sound.play("party");
    setTimeout(() => sound.play("party"), 1760);
    this.say("byte", "MODO FESTA ATIVADO!");
    setTimeout(() => this.say("pixel", "cima, cima, baixo, baixo... clássico."), 1800);
    const confetti = setInterval(() => fx.burst(Math.random() * innerWidth, -10, { n: 4, colors: NEON, speed: 2, size: 7, dir: 90, spread: 50, gravity: 0.06, life: 160, drag: 0.995 }), 80);
    await wait(3600);
    clearInterval(confetti);
    this.crew.list.forEach((b) => { b.rig.classList.remove("dance"); b.rig.style.animationDelay = ""; b.busy = false; });
    this.bg.setMode("normal");
    this.mode = null;
    this.crew.setMood("idle");
    this.say("glitch", "ufa. alguém viu meu pixel?");
  }

  /* easter egg: digitar "matrix" */
  async matrix() {
    if (this.mode) return;
    this.wakeIfSleeping();
    this.mode = "matrix";
    this.bg.setMode("matrix");
    this.crew.el.classList.add("matrix");
    sound.play("matrix");
    this.say("glitch", "entrando na matrix... segura o café.");
    await wait(9000);
    this.crew.el.classList.remove("matrix");
    this.bg.setMode("normal");
    this.mode = null;
    this.say("glitch", "voltei. foi estranho.");
  }

  /* easter egg: ficar parado 45 s */
  activity() {
    this.lastActive = performance.now();
    this.wakeIfSleeping();
  }
  checkIdle() {
    if (this.sleeping || this.mode || this.crew.mood !== "idle" || !this.allIdle()) return;
    if (performance.now() - this.lastActive > IDLE_MS) this.sleep();
  }
  sleep() {
    this.sleeping = true;
    this.crew.setMood("sleep");
    this.crew.el.classList.add("sleeping");
    sound.play("snore");
    this.say("pixel", "zZz... modo economia de energia.");
    const puff = () => this.crew.list.forEach((b, i) => setTimeout(() => {
      if (!this.sleeping) return;
      const h = b.headPoint();
      fx.burst(h.x + 14, h.y + 6, { n: 1, chars: "zZ", colors: ["#a39fd0", "#e9f4ff"], speed: 0.9, dir: -60, spread: 20, gravity: -0.012, life: 110, size: 20 });
    }, i * 450));
    puff();
    this.zzz = setInterval(puff, 1800);
  }
  wakeIfSleeping() {
    if (!this.sleeping) return;
    this.sleeping = false;
    clearInterval(this.zzz);
    this.crew.el.classList.remove("sleeping");
    this.crew.setMood("idle");
    this.crew.list.forEach((b) => { if (!b.busy) b.setFace({ eyes: "tiny", mouth: "o" }); });
    this.hopAll(14);
    sound.play("wake");
    this.say("byte", "ah! eu tava só... processando.");
    setTimeout(() => { if (this.crew.mood === "idle") this.crew.setMood("idle"); this.crew.list.forEach((b) => { if (!b.busy) this.crew.restore(b); }); }, 700);
  }

  /* arrastando um arquivo por cima da página */
  dragHover(on, dropEl) {
    if (on === this.dragging) return;
    this.dragging = on;
    if (on) {
      this.wakeIfSleeping();
      this.crew.target = dropEl;
      this.crew.list.forEach((b) => { if (!b.busy) b.setFace({ eyes: "tiny", mouth: "big" }); });
      this.say("pixel", "solta aqui! tô com fome.");
    } else {
      if (this.crew.target === dropEl) this.crew.target = null;
      this.crew.list.forEach((b) => { if (!b.busy) this.crew.restore(b); });
    }
  }
}
