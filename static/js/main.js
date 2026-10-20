import { Crew } from "./buddies.js";
import { createBackground } from "./background.js";
import { Scenes } from "./scenes.js";
import { sound } from "./sound.js";

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAX_BYTES = 15 * 1024 * 1024;

const bg = createBackground($("#bg"), { reduceMotion });
const crew = new Crew($("#crew"), { reduceMotion });
const scenes = new Scenes({ crew, bg, reduceMotion, term: $("#term"), sr: $("#sr"), stage: $("#stage") });
window.ocrBuddies = { crew, scenes, bg }; // brinque pelo console :)

const drop = $("#drop"), fileInput = $("#file");
let current = { data: null, url: null }, reading = false;

/* ================= entrada ================= */
addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
  scenes.dragHover(true, drop);
});
addEventListener("dragleave", (e) => {
  if (e.relatedTarget) return; // só quando sai da janela
  drop.classList.remove("over");
  scenes.dragHover(false, drop);
});
addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  scenes.dragHover(false, drop);
  const f = [...e.dataTransfer.files][0];
  if (f) handle(f);
});
addEventListener("paste", (e) => {
  if (e.target.closest?.("textarea, [contenteditable]")) return; // colar texto no editor continua normal
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) { e.preventDefault(); handle(item.getAsFile()); }
});
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handle(fileInput.files[0]); fileInput.value = ""; });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });

async function ocr(file) {
  const fd = new FormData();
  fd.append("file", file, file.name || "print.png");
  const res = await fetch("/api/ocr", { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json();
}

async function handle(file) {
  scenes.activity();
  if (reading) { scenes.say("pixel", "calma! ainda tô mastigando o anterior."); sound.play("error"); return; }
  if (!file.type.startsWith("image/")) { scenes.error("isso não é imagem. eu só como print."); return; }
  if (file.size > MAX_BYTES) { scenes.error("imagem maior que 15 MB. é muita coisa pra mastigar."); return; }
  reading = true;
  if (current.url) URL.revokeObjectURL(current.url);
  current.url = URL.createObjectURL(file);

  const req = ocr(file).then((d) => ({ d }), (e) => ({ e })); // já dispara o OCR enquanto a animação roda
  await scenes.eatImage(current.url, drop);

  $("#img").src = current.url;
  $("#result").classList.add("show");
  drop.classList.add("compact");
  $("#preview").classList.add("scanning");
  $("#ov").replaceChildren();
  $("#meta").textContent = "lendo...";
  scenes.startReading();
  const t0 = performance.now();
  const { d, e } = await req;
  const rest = 900 - (performance.now() - t0); // a leitura "respira" mesmo quando o OCR é instantâneo
  if (rest > 0) await new Promise((r) => setTimeout(r, rest));
  scenes.stopReading();
  $("#preview").classList.remove("scanning");
  reading = false;
  if (e) { $("#meta").textContent = "erro: " + e.message; scenes.error(e.message); return; }
  show(d);
  scenes.reactResult(d, $("#preview"));
  scenes.reactMarks(d, document.querySelector("#tbl td.doubt, #tbl td.rescued"));
}

/* ================= resultado ================= */
function show(data) {
  current.data = data;
  const ov = $("#ov"), { w, h } = data.image_size;
  ov.setAttribute("viewBox", `0 0 ${w} ${h}`);
  ov.replaceChildren(...data.boxes.map((b) => {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", b.x0); r.setAttribute("y", b.y0);
    r.setAttribute("width", b.x1 - b.x0); r.setAttribute("height", b.y1 - b.y0);
    if (b.doubt) r.classList.add("doubt");
    else if (b.rescued) r.classList.add("rescued");
    else if (b.changed) r.classList.add("changed");
    return r;
  }));
  const c = data.consensus || {};
  const vote = c.checked
    ? `  ·  votação: ${c.checked} relidos ${c.voters}x` +
      [[c.changed, "corrigido", "corrigidos"], [c.fixed, "ajustado", "ajustados"], [c.rescued, "resgatado", "resgatados"], [c.doubts, "dúvida", "dúvidas"]]
        .filter(([n]) => n).map(([n, one, many]) => `, ${n} ${n === 1 ? one : many}`).join("")
    : "";
  $("#meta").textContent = data.kind === "empty"
    ? "nenhum texto encontrado."
    : `${data.boxes.length} trechos  ·  ${(data.seconds + (c.seconds || 0)).toFixed(1)}s  ·  confiança ${Math.round(data.avg_score * 100)}%${vote}`;
  $("#txt").value = data.text;
  renderTable(data);
  const chip = $("#chip");
  chip.hidden = data.kind === "empty";
  chip.classList.toggle("off", data.kind !== "table");
  chip.textContent = data.kind === "table" ? `tabela · ${Math.round(data.table_confidence * 100)}%` : "texto corrido";
  tab(data.kind === "table" ? "table" : "text");
}

function renderTable(data) {
  const rows = data.table || [];
  const doubt = data.table_doubt || [], rescued = data.table_rescued || [], fixed = data.table_fixed || [];
  const marks = { doubt: 0, rescued: 0, fixed: 0 };
  $("#tbl").replaceChildren(...rows.map((row, ri) => {
    const tr = document.createElement("tr");
    row.forEach((cell, ci) => {
      const td = document.createElement("td");
      td.contentEditable = "plaintext-only";
      td.textContent = cell;
      const d = doubt[ri]?.[ci], r = rescued[ri]?.[ci], f = fixed[ri]?.[ci];
      if (d) { td.classList.add("doubt"); td.title = "confere: " + d; marks.doubt++; }
      else if (r) { td.classList.add("rescued"); td.title = "o detector tinha perdido esta célula; achei relendo a área 5 vezes"; marks.rescued++; }
      else if (f) { td.classList.add("fixed"); td.title = f; marks.fixed++; }
      // corrigiu na mão? a marcação sai
      td.addEventListener("input", () => { td.classList.remove("doubt", "rescued", "fixed"); td.removeAttribute("title"); }, { once: true });
      tr.append(td);
    });
    return tr;
  }));
  const cap = $("#tcap"), notes = $("#tnotes");
  cap.textContent = data.caption?.length ? "título: " + data.caption.join(" · ") : "";
  notes.textContent = data.notes?.length ? "nota: " + data.notes.join(" · ") : "";
  cap.hidden = !cap.textContent; notes.hidden = !notes.textContent;
  const legend = $("#legend");
  const LABEL = { doubt: ["dúvida, confere", "dúvidas, confere"], rescued: ["resgatada", "resgatadas"], fixed: ["ajustada (R$, vírgula)", "ajustadas (R$, vírgula)"] };
  legend.replaceChildren(...Object.keys(LABEL).filter((k) => marks[k]).map((k) => {
    const s = document.createElement("span");
    s.className = "lg " + k;
    s.textContent = `${marks[k]} ${LABEL[k][marks[k] === 1 ? 0 : 1]}`;
    return s;
  }));
  legend.hidden = !legend.children.length;
  current.marks = marks;
}
const tableRows = () => [...document.querySelectorAll("#tbl tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim()));

function tab(which) {
  const isTable = which === "table";
  $("#tabText").setAttribute("aria-selected", String(!isTable));
  $("#tabTable").setAttribute("aria-selected", String(isTable));
  $("#panelText").hidden = isTable; $("#actText").hidden = isTable;
  $("#panelTable").hidden = !isTable; $("#actTable").hidden = !isTable;
}
$("#tabText").onclick = () => tab("text");
$("#tabTable").onclick = () => tab("table");
$("#boxes").addEventListener("change", (e) => $("#preview").classList.toggle("nobox", !e.target.checked));

/* ================= copiar e baixar ================= */
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
function save(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const snippet = (t) => { const s = t.trim().split("\n")[0].trim(); return s.length > 18 ? s.slice(0, 18) + "..." : s; };

// Guardar o botão ANTES do await: depois dele o navegador zera e.currentTarget.
$("#copyText").onclick = async (e) => {
  const btn = e.currentTarget, t = $("#txt").value;
  if (!t.trim()) { scenes.say("byte", "não tem nada pra copiar ainda."); return; }
  if (await copy(t)) scenes.copyToss(snippet(t), btn);
};
$("#copyTable").onclick = async (e) => {
  const btn = e.currentTarget, rows = tableRows();
  if (!rows.length) { scenes.say("byte", "não tem tabela pra copiar."); return; }
  if (await copy(rows.map((r) => r.join("\t")).join("\n"))) scenes.copyToss(`tabela ${rows.length}x${rows[0].length}`, btn);
};
$("#dlTxt").onclick = (e) => {
  save(new Blob([$("#txt").value], { type: "text/plain;charset=utf-8" }), "texto.txt");
  scenes.downloadThrow("txt", "texto.txt", e.currentTarget);
};
async function exportTable(fmt, btn) {
  const res = await fetch("/api/export/" + fmt, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: tableRows() }) });
  if (!res.ok) { scenes.error("não consegui gerar o arquivo."); return; }
  save(await res.blob(), "tabela." + fmt);
  scenes.downloadThrow(fmt, "tabela." + fmt, btn);
}
$("#dlXlsx").onclick = (e) => exportTable("xlsx", e.currentTarget);
$("#dlCsv").onclick = (e) => exportTable("csv", e.currentTarget);

/* ================= som ================= */
const muteBtn = $("#mute");
const syncMute = () => {
  muteBtn.setAttribute("aria-pressed", String(sound.muted));
  muteBtn.setAttribute("aria-label", sound.muted ? "Som desligado (clique para ligar)" : "Som ligado (clique para desligar)");
};
muteBtn.onclick = () => { sound.toggle(); syncMute(); };
syncMute();

/* ================= easter eggs ================= */
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
let kpos = 0, typed = "";
addEventListener("keydown", (e) => {
  scenes.activity();
  if (e.target.closest?.("textarea, input, [contenteditable]")) return; // digitando no editor não conta
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  kpos = k === KONAMI[kpos] ? kpos + 1 : k === KONAMI[0] ? 1 : 0;
  if (kpos === KONAMI.length) { kpos = 0; scenes.party(); }
  if (e.key.length === 1) {
    typed = (typed + k).slice(-6);
    if (typed === "matrix") { typed = ""; scenes.matrix(); }
  }
});
let lastMove = 0;
addEventListener("pointermove", () => { const t = performance.now(); if (t - lastMove > 500) { lastMove = t; scenes.activity(); } }, { passive: true });
addEventListener("pointerdown", () => scenes.activity());

scenes.say("byte", "cola um print aí! a gente lê pra você.");
