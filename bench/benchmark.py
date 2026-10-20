"""Benchmark reproduzível: gera tabelas difíceis com gabarito e mede acerto por célula.

    python bench/benchmark.py            # 30 imagens, semente fixa
    python bench/benchmark.py --n 60

Variações: fontes instaladas no sistema (os números mudam um pouco entre máquinas), texto pequeno, título/faixa/legenda fora da tabela, cabeçalho em 2 linhas,
linhas zebradas, modo escuro, JPEG forte, desfoque. Conteúdo com R$, %, datas e códigos.
"""
from __future__ import annotations

import argparse
import io
import random
import statistics
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ocr_engine  # noqa: E402

FONT_DIRS = ["/usr/share/fonts", "C:/Windows/Fonts", "/Library/Fonts", "/System/Library/Fonts"]
FONT_NAMES = ["DejaVuSans.ttf", "DejaVuSerif.ttf", "DejaVuSansMono.ttf", "FreeSans.ttf", "Carlito-Regular.ttf",
              "Caladea-Regular.ttf", "arial.ttf", "calibri.ttf", "times.ttf", "Arial.ttf"]

WORDS = ["Caneta", "Caderno", "Mochila", "Borracha", "Régua", "Estojo", "Tesoura", "Grampeador", "Cola", "Lápis",
         "Ação", "Fundo", "Renda", "Crédito", "Poupança", "Imóvel", "Saúde", "Educação", "Transporte", "Energia"]
HEADERS = [["Produto", "Qtd", "Preço", "Total"], ["Ativo", "Data", "Variação", "Saldo"],
           ["Item", "Código", "Valor"], ["Cliente", "Plano", "Mensalidade", "Status"]]
TWO_LINE = {"Mensalidade": ("Mensali-", "dade"), "Variação": ("Variação", "(%)"), "Total": ("Valor", "total")}


def find_fonts() -> list[str]:
    found = []
    for name in FONT_NAMES:
        for d in FONT_DIRS:
            hits = list(Path(d).rglob(name)) if Path(d).exists() else []
            if hits:
                found.append(str(hits[0]))
                break
    if not found:
        raise SystemExit("nenhuma fonte encontrada para gerar as imagens")
    return found


def cell(kind: str, rnd: random.Random) -> str:
    if kind in ("Qtd",):
        return str(rnd.randint(1, 120))
    if kind in ("Preço", "Valor", "Total", "Saldo", "Mensalidade"):
        v = rnd.uniform(1, 25000)
        return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if kind == "Variação":
        return f"{rnd.uniform(-9.99, 9.99):+.2f}%".replace(".", ",")
    if kind == "Data":
        return f"{rnd.randint(1, 28):02d}/{rnd.randint(1, 12):02d}/20{rnd.randint(19, 26)}"
    if kind == "Código":
        return f"{rnd.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{rnd.randint(1, 9)}-{rnd.randint(10, 9999):04d}"
    if kind == "Status":
        return rnd.choice(["Ativo", "Pendente", "Cancelado", "Em dia"])
    if kind == "Plano":
        return rnd.choice(["Básico", "Plus", "Premium", "Família"])
    return rnd.choice(WORDS) + (" " + rnd.choice(["azul", "A4", "XL", "Pro"]) if rnd.random() < 0.3 else "")


def make_case(i: int, fonts: list[str], rnd: random.Random):
    hdr = rnd.choice(HEADERS)
    nrows = rnd.randint(4, 8)
    body = [[cell(h, rnd) for h in hdr] for _ in range(nrows)]
    font_path = rnd.choice(fonts)
    size = rnd.choice([12, 13, 15, 18])
    dark = rnd.random() < 0.2
    zebra = rnd.random() < 0.5
    framed = rnd.random() < 0.5
    two_line = rnd.random() < 0.4
    has_title = rnd.random() < 0.6
    f = ImageFont.truetype(font_path, size)
    fb = ImageFont.truetype(font_path, size + 1)
    pad_x, row_h = int(size * 1.4), int(size * 2.0)
    widths = [max(f.getlength(t) for t in [h] + [r[c] for r in body]) + 2 * pad_x for c, h in enumerate(hdr)]
    W = int(sum(widths) + 40)
    head_h = row_h * (2 if two_line else 1)
    top = 20 + (int(size * 2.4) if has_title else 0)
    H = int(top + head_h + nrows * row_h + (int(size * 3) if has_title else 0) + 20)
    bg, fg, line = (("#1e1f24", "#e6e6e6", "#3a3c44") if dark else ("#ffffff", "#1a1a1a", "#b8c2cc"))
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    if has_title:
        d.text((20, 18), f"Tabela {i + 1} - Relatório", font=fb, fill=fg)
    x = 20
    xs = []
    for w in widths:
        xs.append(x)
        x += w
    y = top
    d.rectangle((20, y, x, y + head_h), fill="#2d4f73" if dark else "#dfe9f2")
    for c, h in enumerate(hdr):
        cx = xs[c] + widths[c] / 2
        if two_line and h in TWO_LINE:
            a, b = TWO_LINE[h]
            d.text((cx, y + head_h * 0.3), a, font=fb, fill=fg, anchor="mm")
            d.text((cx, y + head_h * 0.72), b, font=fb, fill=fg, anchor="mm")
        else:
            d.text((cx, y + head_h / 2), h, font=fb, fill=fg, anchor="mm")
    y += head_h
    for r, row in enumerate(body):
        if zebra and r % 2 == 0:
            d.rectangle((20, y, x, y + row_h), fill="#26282f" if dark else "#f1f5f9")
        for c, t in enumerate(row):
            d.text((xs[c] + widths[c] / 2, y + row_h / 2), t, font=f, fill=fg, anchor="mm")
        if framed:
            d.line((20, y, x, y), fill=line)
        y += row_h
    if framed:
        for xx in xs + [x]:
            d.line((xx, top, xx, y), fill=line)
        d.line((20, y, x, y), fill=line)
    if has_title:
        d.text((20, y + size), "Fonte: dados de exemplo.", font=f, fill=fg)
    # degradações de print real
    if rnd.random() < 0.35:
        img = img.filter(ImageFilter.GaussianBlur(0.6))
    if rnd.random() < 0.3:
        k = 0.75
        img = img.resize((int(W * k), int(H * k)), Image.BILINEAR).resize((W, H), Image.BILINEAR)
    buf = io.BytesIO()
    if rnd.random() < 0.4:
        img.save(buf, "JPEG", quality=35)
    else:
        img.save(buf, "PNG")
    header_truth = [" ".join(TWO_LINE[h]) if two_line and h in TWO_LINE else h for h in hdr]
    tags = [Path(font_path).stem, f"{size}px"] + [t for t, on in (("escuro", dark), ("zebra", zebra), ("2linhas", two_line), ("titulo", has_title)) if on]
    return buf.getvalue(), [header_truth] + body, tags


def norm(s: str) -> str:
    return " ".join(s.split())


def score(pred: list[list[str]], truth: list[list[str]]) -> tuple[int, int, int, bool]:
    """(certas exatas, certas ignorando espaços, total, grade certa).
    O modelo às vezes come espaço ("R$849,26"): conteúdo certo, mas não idêntico. Medimos os dois."""
    total = sum(len(r) for r in truth)
    ok = ok_ns = 0
    for ri, row in enumerate(truth):
        for ci, t in enumerate(row):
            if ri < len(pred) and ci < len(pred[ri]):
                ok += norm(pred[ri][ci]) == norm(t)
                ok_ns += pred[ri][ci].replace(" ", "") == t.replace(" ", "")
    shape = len(pred) == len(truth) and all(len(p) == len(t) for p, t in zip(pred, truth))
    return ok, ok_ns, total, shape


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--show-errors", action="store_true")
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    fonts = find_fonts()
    cases = [make_case(i, fonts, rnd) for i in range(a.n)]
    ocr_engine.get_engine()
    # camadas medidas separadas: estrutura | + ajustes por contexto (R$, vírgula) | + votação de 5 leituras
    modes = {"estrutura": (False, False), "+ ajustes": (False, True), "+ votação": (True, True)}
    res = {m: {"ok": 0, "ok_ns": 0, "tot": 0, "shape": 0, "t": [], "flag_hit": 0, "errs": 0, "flags": 0} for m in modes}
    for idx, (data, truth, tags) in enumerate(cases):
        for m, cons in modes.items():
            t0 = time.perf_counter()
            r = ocr_engine.analyze(data, consensus=cons[0], fixes=cons[1])
            res[m]["t"].append(time.perf_counter() - t0)
            ok, ok_ns, tot, shape = score(r["table"], truth)
            res[m]["ok"] += ok
            res[m]["ok_ns"] += ok_ns
            res[m]["tot"] += tot
            res[m]["shape"] += shape
            if shape:  # marcações só fazem sentido com a grade certa
                for ri, row in enumerate(truth):
                    for ci, t in enumerate(row):
                        wrong = r["table"][ri][ci].replace(" ", "") != t.replace(" ", "")
                        flagged = bool(r["table_doubt"][ri][ci])
                        res[m]["errs"] += wrong
                        res[m]["flags"] += flagged
                        res[m]["flag_hit"] += wrong and flagged
                        if a.show_errors and flagged and not wrong:
                            print(f"  [{m}] #{idx} ALARME FALSO {t!r}: {r['table_doubt'][ri][ci]}")
                        if a.show_errors and wrong:
                            print(f"  [{m}] #{idx} {tags}: esperado {t!r} veio {r['table'][ri][ci]!r}" + (" (marcado)" if flagged else ""))
            elif a.show_errors:
                print(f"  [{m}] #{idx} {tags}: grade errada {len(r['table'])}x{len(r['table'][0]) if r['table'] else 0} (esperado {len(truth)}x{len(truth[0])})")
    print(f"\n{a.n} imagens, semente {a.seed}\n")
    print(f"{'modo':<14} {'células exatas':>15} {'ignorando espaço':>17} {'grade certa':>12} {'tempo médio':>12} {'erros marcados':>15} {'alarmes falsos':>15}")
    for m, v in res.items():
        flagged = f"{v['flag_hit']}/{v['errs']}" if v["errs"] else "-"
        false_alarm = v["flags"] - v["flag_hit"]
        print(f"{m:<14} {100 * v['ok'] / v['tot']:>14.1f}% {100 * v['ok_ns'] / v['tot']:>16.1f}% {v['shape']:>8}/{a.n:<3} {statistics.mean(v['t']):>11.2f}s {flagged:>15} {false_alarm:>15}")


if __name__ == "__main__":
    main()
