"""Rode com:  python -m pytest -q   (pip install pytest)"""
import io
from pathlib import Path

from PIL import Image

import ocr_engine

SAMPLES = Path(__file__).parent.parent / "samples"


def read(name: str, **kw) -> dict:
    return ocr_engine.analyze((SAMPLES / name).read_bytes(), **kw)


def test_tabela_vira_tabela_com_colunas_certas():
    r = read("tabela.png")
    assert r["kind"] == "table"
    assert r["table"][0] == ["Produto", "Qtd", "Preço", "Total"]
    assert [row[1] for row in r["table"][1:]] == ["10", "4", "1", "12"]


def test_tabela_com_titulo_faixa_cabecalho_em_2_linhas_e_legenda():
    # caso real que quebrava: título e faixa atravessando colunas colavam "Indivíduo" com "Idade"
    r = read("tabela_complexa.png")
    assert r["kind"] == "table"
    assert r["caption"] == ["Tabela 1 - Exemplo", "TABELA"]
    assert r["notes"] == ["Fonte: elaborado pela autora."]
    assert r["table"][0] == ["Indivíduo", "Idade", "Consumo de água"]
    assert r["table"][1:] == [
        ["1", "10 anos", "8x ao dia"], ["2", "8 anos", "6x ao dia"], ["3", "12 anos", "10x ao dia"],
        ["4", "9 anos", "7x ao dia"], ["5", "11 anos", "9x ao dia"],
    ]


def test_texto_corrido_mantem_acentos_e_paragrafos():
    r = read("texto.png")
    assert r["kind"] == "text"
    assert "relatório" in r["text"] and "projeção" in r["text"]
    assert "\n\n" in r["text"]


def test_imagem_sem_texto_nao_quebra():
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(buf, "PNG")
    r = ocr_engine.analyze(buf.getvalue())
    assert r["kind"] == "empty" and r["boxes"] == []


def test_ajustes_de_valor_brasileiro():
    t = [["Ativo", "Saldo", "Var"], ["a", "RS 6.211,42", "+2.85%"], ["b", "R5 2.268.77", "-1,02%"],
         ["c", "R$ 24.911.88", "+0,50%"], ["d", "192.168.10.20", "3,33%"]]
    notes = ocr_engine.normalize_table(t)
    assert t[1] == ["a", "R$ 6.211,42", "+2,85%"]
    assert t[2][1] == "R$ 2.268,77"
    assert t[3][1] == "R$ 24.911,88"
    assert t[4][1] == "192.168.10.20"  # não é dinheiro: não mexe
    assert notes[1][1] and not notes[4][1]


def test_voto_conta_variantes_do_mesmo_valor_juntas():
    ranked = ocr_engine._tally([("RS 8.755,11", 0.9), ("R5 8.755,11", 0.8), ("R$ 8.755,11", 0.95), ("8755", 0.3)])
    text, scores = ranked[0]
    assert text == "R$ 8.755,11" and len(scores) == 3


def test_coluna_numerica_marca_letra_como_duvida():
    flags = ocr_engine.column_checks([["N", "Idade"], ["1", "10"], ["2", "8"], ["B", "12"], ["4", "9"]])
    assert "3 ou 8" in flags[3][0]
    assert not flags[1][0]
