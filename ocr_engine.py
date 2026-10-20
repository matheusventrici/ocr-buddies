"""Motor de OCR: leitura, consenso por votação e reconstrução de texto/tabela.

Pipeline:
  1. RapidOCR detecta e lê cada trecho (com a posição na imagem).
  2. Consenso: trechos duvidosos são relidos em 4 versões da imagem
     (ampliada, contraste, binarizada, nitidez). Com a leitura original, são 5 votos.
     Vence o texto mais repetido. Se menos de 3 de 5 concordam, o trecho é marcado como dúvida.
  3. Estrutura: linhas pelo centro vertical; colunas só a partir das linhas com 2+ trechos
     (título, faixa e legenda atravessam colunas e não podem "colar" colunas vizinhas);
     título/legenda ficam fora da tabela; célula com texto em 2 linhas é juntada.
  4. Resgate: célula vazia no meio da tabela é recortada e lida pelos 5 caminhos,
     porque o detector às vezes perde caracteres soltos (ex.: um "5" sozinho).
"""
from __future__ import annotations

import io
import math
import re
import statistics
import time
from dataclasses import dataclass, asdict, field

import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageStat
from rapidocr import RapidOCR

# "R$" é o par de caracteres que o modelo mais erra em tabela brasileira ("RS", "R5", "R8", "BS"...).
# Só troca quando o resto da célula é claramente um valor monetário (1.234,56).
_MONEY = re.compile(r"^[RBEH]\s?[S$s58]\s?(-?\d{1,3}(?:[.\s]?\d{3})*,\d{2})$")
_DEC_DOT = re.compile(r"^(.*\d)\.(\d{2})(%?)$")
# "24.911.88": com milhar em ponto e só 2 dígitos no fim, o último separador só pode ser vírgula
_BR_BROKEN = re.compile(r"^(.*?\d{1,3}(?:\.\d{3})+)\.(\d{2})(%?)$")

MIN_SIDE = 900        # abaixo disso a imagem é ampliada antes do OCR
MAX_SIDE = 3000
REVOTE_SCORE = 0.985  # trechos com confiança abaixo disso vão para a votação
REVOTE_SHORT = 3      # textos curtos (ex.: "3" vs "B") sempre vão: o modelo erra com convicção neles
VOTERS = 5            # leitura original + 4 variantes
MIN_AGREE = 3         # concordância mínima para não marcar dúvida

_engine: RapidOCR | None = None


def get_engine() -> RapidOCR:
    global _engine
    if _engine is None:
        _engine = RapidOCR(params={"Global.log_level": "warning"})
    return _engine


@dataclass
class Box:
    text: str
    score: float
    x0: float
    y0: float
    x1: float
    y1: float
    votes: int = 0          # quantas das 5 leituras concordaram (0 = não passou pela votação)
    changed: bool = False   # a votação trocou o texto original
    doubt: bool = False     # menos de MIN_AGREE leituras concordaram
    rescued: bool = False   # achado pelo resgate de célula vazia
    alts: list = field(default_factory=list)  # outras leituras, para mostrar na dúvida

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def h(self) -> float:
        return self.y1 - self.y0


# --------------------------------------------------------------------------- leitura

def _prepare(img: Image.Image) -> tuple[Image.Image, float]:
    w, h = img.size
    short, long_ = min(w, h), max(w, h)
    scale = 1.0
    if short < MIN_SIDE:
        scale = MIN_SIDE / short
    if long_ * scale > MAX_SIDE:
        scale = MAX_SIDE / long_
    if abs(scale - 1.0) > 0.01:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return img, scale


def read_boxes(img: Image.Image) -> tuple[list[Box], float]:
    """Detecta e lê. Caixas voltam em coordenadas da imagem original."""
    prepared, scale = _prepare(img)
    t0 = time.perf_counter()
    result = get_engine()(np.array(prepared))
    elapsed = time.perf_counter() - t0
    boxes: list[Box] = []
    if result.txts is None:
        return boxes, elapsed
    for pts, text, score in zip(result.boxes, result.txts, result.scores):
        xs = [float(p[0]) for p in pts]  # float nativo: numpy.float32 não serializa em JSON
        ys = [float(p[1]) for p in pts]
        text = str(text).strip()
        if text:
            boxes.append(Box(text, float(score), min(xs) / scale, min(ys) / scale, max(xs) / scale, max(ys) / scale))
    return boxes, elapsed


# --------------------------------------------------------------------------- consenso

def _otsu(gray: Image.Image) -> int:
    hist = np.array(gray.histogram()[:256], dtype=float)
    total = hist.sum()
    if total == 0:
        return 128
    w_b = np.cumsum(hist)
    m_b = np.cumsum(hist * np.arange(256))
    w_f = total - w_b
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (m_b[-1] * w_b / total - m_b) ** 2 / (w_b * w_f)
    return int(np.nanargmax(between))


def _variants(crop: Image.Image) -> list[np.ndarray]:
    """4 versões do mesmo recorte. Cada uma 'engana' o modelo de um jeito diferente;
    o erro que aparece em uma raramente se repete nas outras."""
    crop = crop.convert("RGB")
    k = max(2, math.ceil(40 / max(1, crop.height)))  # texto bem pequeno ganha mais ampliação
    up = lambda im: im.resize((im.width * k, im.height * k), Image.LANCZOS)
    gray = ImageOps.grayscale(crop)
    if ImageStat.Stat(gray).mean[0] < 110:  # fundo escuro (modo dark): inverte para texto escuro no claro
        gray = ImageOps.invert(gray)
    t = _otsu(gray)
    return [
        np.array(up(crop)),
        np.array(ImageOps.autocontrast(up(gray), cutoff=2).convert("RGB")),
        np.array(up(gray.point(lambda p: 255 if p > t else 0)).convert("RGB")),
        np.array(up(crop).filter(ImageFilter.UnsharpMask(radius=2, percent=180, threshold=2))),
    ]


def _crop(img: Image.Image, x0, y0, x1, y1, h) -> Image.Image:
    px, py = 0.25 * h, 0.18 * h
    box = (max(0, int(x0 - px)), max(0, int(y0 - py)), min(img.width, int(math.ceil(x1 + px))), min(img.height, int(math.ceil(y1 + py))))
    return img.crop(box)


def _recognize(crops: list[np.ndarray]) -> list[tuple[str, float]]:
    if not crops:
        return []
    out = get_engine().recognize_txt(crops)  # um lote só: bem mais rápido que chamar um a um
    return [(str(t).strip(), float(s)) for t, s in zip(out.txts, out.scores)]


def _canon(text: str) -> str:
    """Forma canônica para contar votos: "RS 8.755,11", "R5 8.755,11" e "R$ 8.755,11" são o mesmo voto."""
    t = " ".join(text.split())
    m = _MONEY.match(t)
    return "R$ " + m.group(1) if m else t


def _tally(cands: list[tuple[str, float]]):
    """Agrupa leituras iguais. Vence a mais votada; empate vai para a maior confiança somada."""
    t: dict[str, list[float]] = {}
    for text, score in cands:
        key = _canon(text)
        if key:
            t.setdefault(key, []).append(score)
    ranked = sorted(t.items(), key=lambda kv: (len(kv[1]), sum(kv[1])), reverse=True)
    return ranked


def revote(img: Image.Image, boxes: list[Box]) -> dict:
    """Relê os trechos duvidosos em 4 variantes e decide por maioria (5 votos com a leitura original)."""
    if not boxes:
        return {"checked": 0, "changed": 0, "doubts": 0}
    med_h = statistics.median(b.h for b in boxes)
    pick = [b for b in boxes if b.score < REVOTE_SCORE or len(b.text) <= REVOTE_SHORT]
    crops, owner = [], []
    for b in pick:
        for v in _variants(_crop(img, b.x0, b.y0, b.x1, b.y1, max(b.h, med_h * 0.8))):
            crops.append(v)
            owner.append(b)
    reads = _recognize(crops)
    per: dict[int, list] = {id(b): [(b.text, b.score)] for b in pick}
    for b, r in zip(owner, reads):
        per[id(b)].append(r)
    changed = doubts = 0
    for b in pick:
        ranked = _tally(per[id(b)])
        if not ranked:
            continue
        text, scores = ranked[0]
        b.votes = len(scores)
        b.alts = [t for t, _ in ranked[1:3]]
        if text != _canon(b.text):
            b.changed = True
            changed += 1
            b.text = text
        b.score = sum(scores) / len(scores)
        if b.votes < MIN_AGREE:
            b.doubt = True
            doubts += 1
    return {"checked": len(pick), "changed": changed, "doubts": doubts}


# --------------------------------------------------------------------------- estrutura

def group_rows(boxes: list[Box]) -> list[list[Box]]:
    """Agrupa caixas que estão na mesma linha visual (centro vertical próximo)."""
    if not boxes:
        return []
    med_h = statistics.median(b.h for b in boxes)
    rows: list[list[Box]] = []
    for b in sorted(boxes, key=lambda b: b.cy):
        if rows and abs(b.cy - statistics.mean(x.cy for x in rows[-1])) <= 0.55 * med_h:
            rows[-1].append(b)
        else:
            rows.append([b])
    for r in rows:
        r.sort(key=lambda b: b.x0)
    return rows


def _bands(grid: list[list[Box]], med_h: float) -> list[tuple[float, float]]:
    """Colunas = faixas de x ocupadas na maioria das linhas da grade.
    Um trecho largo em uma linha só (ex.: célula mesclada) não fecha o vão entre colunas."""
    x_min = min(b.x0 for r in grid for b in r)
    x_max = max(b.x1 for r in grid for b in r)
    width = int(math.ceil(x_max - x_min)) + 2
    cov = np.zeros(width, dtype=int)
    for r in grid:
        mask = np.zeros(width, dtype=bool)
        for b in r:
            mask[int(b.x0 - x_min): int(math.ceil(b.x1 - x_min)) + 1] = True
        cov += mask
    occupied = cov > int(0.25 * len(grid))
    runs, start = [], None
    for i, on in enumerate(occupied):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append([start, i - 1]); start = None
    if start is not None:
        runs.append([start, width - 1])
    merged = []
    for a, z in runs:  # vão menor que um espaço entre palavras não separa coluna
        if merged and a - merged[-1][1] < 0.3 * med_h:
            merged[-1][1] = z
        else:
            merged.append([a, z])
    return [(a + x_min, z + x_min) for a, z in merged]


def _band_of(b: Box, bands) -> int:
    for i, (a, z) in enumerate(bands):
        if a <= b.cx <= z:
            return i
    return min(range(len(bands)), key=lambda i: abs((bands[i][0] + bands[i][1]) / 2 - b.cx))


def _cell_text(cell: list[Box], med_h: float) -> str:
    return " ".join(b.text for b in sorted(cell, key=lambda b: (round(b.cy / med_h), b.x0)))


def table_structure(rows: list[list[Box]]) -> dict | None:
    """Monta a grade da tabela. Devolve None quando não parece tabela."""
    if not rows:
        return None
    med_h = statistics.median(b.h for r in rows for b in r)
    grid = [r for r in rows if len(r) >= 2]
    if len(grid) < 2:
        return None
    bands = _bands(grid, med_h)
    if len(bands) < 2:
        return None

    mat = []
    for r in rows:
        cells = [[] for _ in bands]
        for b in r:
            cells[_band_of(b, bands)].append(b)
        mat.append({"cells": cells, "top": min(b.y0 for b in r), "bottom": max(b.y1 for b in r), "n": len(r)})

    # título (antes) e legenda/fonte (depois): linhas de um trecho só nas pontas
    caption, notes = [], []
    # (só se não encostar na linha vizinha: a 1ª linha de um cabeçalho em 2 linhas encosta)
    while len(mat) > 1 and mat[0]["n"] == 1 and mat[1]["top"] - mat[0]["bottom"] >= 0:
        caption.append(_cell_text([b for c in mat.pop(0)["cells"] for b in c], med_h))
    while len(mat) > 1 and mat[-1]["n"] == 1 and mat[-1]["top"] - mat[-2]["bottom"] >= 0:
        notes.insert(0, _cell_text([b for c in mat.pop()["cells"] for b in c], med_h))

    # célula com texto em 2 linhas ("Consumo de" / "água") e linha partida pelo agrupamento.
    # Critério relativo: a linha de continuação fica bem mais colada na anterior do que
    # as linhas da tabela costumam ficar entre si. Limite fixo juntava linhas de verdade
    # quando faltava uma célula (ex.: o "5" que o detector perdeu).
    gaps = [b["top"] - a["bottom"] for a, b in zip(mat, mat[1:])]
    typical = statistics.median(gaps) if gaps else 0.0
    limit = min(0.35 * med_h, typical - 0.25 * med_h)
    merged = []
    for row in mat:
        if merged:
            prev = merged[-1]
            gap = row["top"] - prev["bottom"]
            fp = {i for i, c in enumerate(prev["cells"]) if c}
            fc = {i for i, c in enumerate(row["cells"]) if c}
            same_visual_row = gap < limit and fc.isdisjoint(fp)
            continuation = gap < limit and len(fc) < len(fp)
            if same_visual_row or continuation:
                for i, c in enumerate(row["cells"]):
                    prev["cells"][i].extend(c)
                prev["bottom"] = max(prev["bottom"], row["bottom"])
                continue
        merged.append(row)

    keep = [i for i in range(len(bands)) if any(r["cells"][i] for r in merged)]
    bands = [bands[i] for i in keep]
    for r in merged:
        r["cells"] = [r["cells"][i] for i in keep]

    multi = sum(1 for r in merged if sum(1 for c in r["cells"] if c) >= 2)
    is_table = (len(bands) >= 2 and len(merged) >= 3 and len(merged) / len(rows) >= 0.5 and multi / len(merged) >= 0.6)
    fill = [sum(1 for r in merged if r["cells"][i]) / len(merged) for i in range(len(bands))] if merged else []
    solid = sum(1 for f in fill if f >= 0.5)
    conf = round(min(1.0, (multi / len(merged)) * (solid / len(bands))), 2) if merged and bands else 0.0
    return {"rows": merged, "bands": bands, "caption": caption, "notes": notes, "is_table": is_table, "confidence": conf, "med_h": med_h}


def rescue_cells(img: Image.Image, st: dict) -> int:
    """Célula vazia cercada de dados: recorta a área e lê pelos 5 caminhos.
    Só aceita se 3+ leituras concordarem com confiança razoável."""
    med_h, bands, rows = st["med_h"], st["bands"], st["rows"]
    targets = []
    for ri, r in enumerate(rows):
        if ri == 0:
            continue  # cabeçalho pode ter célula vazia de propósito
        for ci, cell in enumerate(r["cells"]):
            col_filled = sum(1 for rr in rows if rr["cells"][ci]) / len(rows)
            if not cell and col_filled >= 0.6:
                targets.append((r, ci))
    if not targets:
        return 0
    crops, owner = [], []
    for r, ci in targets:
        a, z = bands[ci]
        crop = _crop(img, a, r["top"], z, r["bottom"], med_h)
        for v in [np.array(crop.convert("RGB"))] + _variants(crop):
            crops.append(v)
            owner.append((r, ci))
    reads = _recognize(crops)
    per: dict[tuple, list] = {}
    for key, rd in zip(owner, reads):
        per.setdefault((id(key[0]), key[1]), []).append(rd)
    found = 0
    for r, ci in targets:
        ranked = _tally(per.get((id(r), ci), []))
        if not ranked:
            continue
        text, scores = ranked[0]
        # concordância é o sinal principal; a mediana evita que uma variante "insegura" derrube o voto
        if len(scores) >= MIN_AGREE and statistics.median(scores) >= 0.6:
            a, z = bands[ci]
            r["cells"][ci].append(Box(text, sum(scores) / len(scores), a, r["top"], z, r["bottom"], votes=len(scores), rescued=True))
            found += 1
    return found




def normalize_table(table: list[list[str]]) -> list[list[str]]:
    """Ajustes por contexto, célula a célula. Devolve a matriz de motivos ("" = não mexeu)."""
    notes = [["" for _ in r] for r in table]
    # vírgula decimal: se a coluna usa ",dd" e uma célula veio com ".dd", é o mesmo formato mal lido
    for ci in range(len(table[0]) if table else 0):
        vals = [r[ci] for r in table[1:] if r[ci]]
        if len(vals) < 3:
            continue
        comma = sum(1 for v in vals if re.search(r",\d{2}%?$", v)) / len(vals)
        if comma < 0.6:
            continue
        for ri, r in enumerate(table[1:], start=1):
            m = _DEC_DOT.match(r[ci])
            if m:
                old = r[ci]
                r[ci] = f"{m.group(1)},{m.group(2)}{m.group(3)}"
                notes[ri][ci] = (notes[ri][ci] + "; " if notes[ri][ci] else "") + f'"{old}" ajustado para "{r[ci]}" (coluna usa vírgula decimal)'
    for ri, r in enumerate(table):
        for ci, v in enumerate(r):
            m = _BR_BROKEN.match(v)
            if m:
                r[ci] = f"{m.group(1)},{m.group(2)}{m.group(3)}"
                notes[ri][ci] = f'"{v}" ajustado para "{r[ci]}" (número com dois pontos não existe)'
    # depois da vírgula, porque "R5 2.268.77" só vira valor monetário reconhecível após ela
    for ri, r in enumerate(table):
        for ci, v in enumerate(r):
            m = _MONEY.match(v.strip())
            if m and not v.startswith("R$ "):
                r[ci] = "R$ " + m.group(1)
                notes[ri][ci] = (notes[ri][ci] + "; " if notes[ri][ci] else "") + f'"{v}" ajustado para "{r[ci]}"'
    return notes


CONFUSABLE = {"B": "3 ou 8", "O": "0", "o": "0", "D": "0", "I": "1", "l": "1", "|": "1", "S": "5", "s": "5", "Z": "2", "G": "6", "g": "9", "q": "9", "A": "4", "T": "7"}


def column_checks(table: list[list[str]]) -> list[list[str]]:
    """Validação pelo tipo da coluna: se quase toda a coluna tem número e uma célula não tem,
    a célula vira dúvida (não troca sozinho: "B" pode ser 3 ou 8)."""
    flags = [["" for _ in r] for r in table]
    if len(table) < 3:
        return flags
    body = table[1:]  # linha 0 é cabeçalho
    for c in range(len(table[0])):
        vals = [r[c] for r in body if r[c]]
        if len(vals) < 3:
            continue
        with_digit = sum(1 for v in vals if any(ch.isdigit() for ch in v)) / len(vals)
        if with_digit < 0.7:
            continue
        for ri, r in enumerate(body, start=1):
            v = r[c]
            if v and not any(ch.isdigit() for ch in v):
                hint = CONFUSABLE.get(v.strip())
                flags[ri][c] = f"coluna numérica e aqui veio \"{v}\"" + (f" (talvez {hint})" if hint else "")
    return flags


def rows_to_text(rows: list[list[Box]]) -> str:
    """Texto corrido: junta caixas da mesma linha e separa parágrafos por salto vertical."""
    if not rows:
        return ""
    med_h = statistics.median(b.h for r in rows for b in r)
    lines: list[str] = []
    prev_bottom = None
    for r in rows:
        top = min(b.y0 for b in r)
        if prev_bottom is not None and top - prev_bottom > med_h * 1.1:
            lines.append("")
        lines.append(" ".join(b.text for b in r))
        prev_bottom = max(b.y1 for b in r)
    return "\n".join(lines)


# --------------------------------------------------------------------------- API

def analyze(data: bytes, consensus: bool = True, fixes: bool = True) -> dict:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    boxes, elapsed = read_boxes(img)

    t1 = time.perf_counter()
    cons = {"checked": 0, "changed": 0, "doubts": 0}
    if consensus:
        cons = revote(img, boxes)
    rows = group_rows(boxes)
    st = table_structure(rows)
    rescued = 0
    if consensus and st and st["is_table"]:
        rescued = rescue_cells(img, st)
    cons.update(rescued=rescued, voters=VOTERS)

    table, table_doubt, table_rescued, table_fixed, caption, notes = [], [], [], [], [], []
    if st:
        med_h = st["med_h"]
        table = [[_cell_text(c, med_h) for c in r["cells"]] for r in st["rows"]]
        table_fixed = normalize_table(table) if fixes else [["" for _ in r] for r in table]
        col_flags = column_checks(table)
        table_rescued = [[any(b.rescued for b in c) for c in r["cells"]] for r in st["rows"]]
        table_doubt = [
            [col_flags[ri][ci] or next((f"só {b.votes} de {VOTERS} leituras concordaram" + (f" (outras: {', '.join(b.alts)})" if b.alts else "") for b in c if b.doubt), "")
             for ci, c in enumerate(r["cells"])]
            for ri, r in enumerate(st["rows"])
        ]
        caption, notes = st["caption"], st["notes"]
    is_table = bool(st and st["is_table"])
    cons["fixed"] = sum(1 for r in table_fixed for f in r if f)
    if is_table:  # na tabela, dúvida inclui a checagem de coluna, não só a votação
        cons["doubts"] = sum(1 for r in table_doubt for d in r if d)
    cons["seconds"] = round(time.perf_counter() - t1, 2)

    all_boxes = boxes + [b for r in (st["rows"] if st else []) for c in r["cells"] for b in c if b.rescued]
    avg = statistics.mean(b.score for b in boxes) if boxes else 0.0
    return {
        "kind": "empty" if not boxes else ("table" if is_table else "text"),
        "table_confidence": st["confidence"] if st else 0.0,
        "text": rows_to_text(group_rows(all_boxes) if rescued else rows),
        "table": table,               # sempre montada: se a heurística errar, a aba Tabela continua útil
        "table_doubt": table_doubt,   # "" ou o motivo da dúvida, célula a célula
        "table_rescued": table_rescued,
        "table_fixed": table_fixed,   # "" ou o ajuste feito por contexto (R$, vírgula decimal)
        "caption": caption,           # título acima da tabela (fora das células)
        "notes": notes,               # fonte/legenda abaixo da tabela
        "boxes": [asdict(b) for b in all_boxes],
        "image_size": {"w": img.width, "h": img.height},
        "avg_score": round(avg, 3),
        "seconds": round(elapsed, 2),
        "consensus": cons,
    }
