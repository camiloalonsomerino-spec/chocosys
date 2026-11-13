# Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
"""Genera el logo de Chocosys (una «C» naranja) en SVG, PNG e ICO desde una sola geometría.

Uso: python assets/logo/generar.py   (necesita Pillow y numpy)
Deja todo en assets/logo/ y copia a la app lo que usa: app/build/icon.ico, app/build/icon.png y app/renderer/logo-c.png.
"""
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

NARANJA = "#F2662E"  # el mismo naranja (--brasa) del tema de la app
AQUI = Path(__file__).resolve().parent
APP = AQUI.parent.parent / "app"
LADO = 1024
ABERTURA = 48  # grados a cada lado del eje horizontal, a la derecha
MEDIDAS = [1024, 512, 256, 64]
MEDIDAS_ICO = [16, 20, 24, 32, 40, 48, 64, 128, 256]

# Las dos variantes, en unidades del lienzo de 1024: radio del trazo (a su centro) y grosor.
VARIANTES = {
    "transparente": {"radio": 330, "grosor": 190, "fondo": None, "c": NARANJA},
    "fondo-naranja": {"radio": 262, "grosor": 160, "fondo": NARANJA, "c": "#FFFFFF"},
}
ESQUINA = 0.22  # radio de la esquina del cuadrado de fondo, como fracción del lado


def puntas(v):
    a = math.radians(ABERTURA)
    c = LADO / 2
    return (c + v["radio"] * math.cos(a), c - v["radio"] * math.sin(a)), (c + v["radio"] * math.cos(a), c + v["radio"] * math.sin(a))


def svg(v):
    (x1, y1), (x2, y2) = puntas(v)
    r = v["radio"]
    fondo = ""
    if v["fondo"]:
        e = round(LADO * ESQUINA)
        fondo = f'<rect width="{LADO}" height="{LADO}" rx="{e}" fill="{v["fondo"]}"/>'
    # Arco de la punta de arriba a la de abajo pasando por la izquierda (arco largo, sentido antihorario).
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LADO} {LADO}" width="{LADO}" height="{LADO}">'
            f'<title>Chocosys</title>{fondo}'
            f'<path d="M {x1:.2f} {y1:.2f} A {r} {r} 0 1 0 {x2:.2f} {y2:.2f}" fill="none" stroke="{v["c"]}" '
            f'stroke-width="{v["grosor"]}" stroke-linecap="round"/></svg>\n')


def mascara_c(v, n):
    """Cobertura (0 a 1) de la C en una imagen de n×n, con 8×8 muestras por píxel."""
    s = 8
    k = LADO / (n * s)
    y, x = np.mgrid[0:n * s, 0:n * s].astype(np.float64)
    x = (x + 0.5) * k - LADO / 2
    y = LADO / 2 - (y + 0.5) * k
    r = np.hypot(x, y)
    ang = np.degrees(np.arctan2(y, x))
    en_arco = np.abs(ang) >= ABERTURA
    medio = v["grosor"] / 2
    dentro = en_arco & (np.abs(r - v["radio"]) <= medio)
    for (px, py) in puntas(v):
        cx, cy = px - LADO / 2, LADO / 2 - py
        dentro |= np.hypot(x - cx, y - cy) <= medio
    return dentro.reshape(n, s, n, s).mean(axis=(1, 3))


def mascara_fondo(n):
    s = 8
    k = LADO / (n * s)
    y, x = np.mgrid[0:n * s, 0:n * s].astype(np.float64)
    x = np.abs((x + 0.5) * k - LADO / 2)
    y = np.abs((y + 0.5) * k - LADO / 2)
    e = LADO * ESQUINA
    q = LADO / 2 - e
    dx, dy = np.maximum(x - q, 0), np.maximum(y - q, 0)
    return (np.hypot(dx, dy) <= e).reshape(n, s, n, s).mean(axis=(1, 3))


def rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def imagen(v, n):
    c = mascara_c(v, n)
    px = np.zeros((n, n, 4), dtype=np.float64)
    if v["fondo"]:
        f = mascara_fondo(n)
        px[..., :3] = np.array(rgb(v["fondo"])) * (1 - c[..., None]) + np.array(rgb(v["c"])) * c[..., None]
        px[..., 3] = f * 255
    else:
        px[..., :3] = rgb(v["c"])
        px[..., 3] = c * 255
    return Image.fromarray(np.round(px).astype(np.uint8), "RGBA")


def main():
    for nombre, v in VARIANTES.items():
        (AQUI / f"chocosys-c-{nombre}.svg").write_text(svg(v), encoding="utf-8")
        for n in MEDIDAS:
            sufijo = "" if n == LADO else f"-{n}"
            imagen(v, n).save(AQUI / f"chocosys-c-{nombre}{sufijo}.png", optimize=True)
    # El icono de la app y del instalador: la C blanca sobre fondo naranja, dibujada en cada medida (no achicada).
    v = VARIANTES["fondo-naranja"]
    capas = [imagen(v, n) for n in MEDIDAS_ICO]
    capas[-1].save(AQUI / "chocosys.ico", format="ICO", sizes=[(n, n) for n in MEDIDAS_ICO], append_images=capas[:-1])
    shutil.copyfile(AQUI / "chocosys.ico", APP / "build" / "icon.ico")
    shutil.copyfile(AQUI / "chocosys-c-fondo-naranja.png", APP / "build" / "icon.png")
    shutil.copyfile(AQUI / "chocosys-c-transparente-256.png", APP / "renderer" / "logo-c.png")
    # Revisión: el .ico trae cada medida pedida.
    with Image.open(AQUI / "chocosys.ico") as ico:
        medidas = sorted(s[0] for s in ico.info["sizes"])
    assert medidas == sorted(MEDIDAS_ICO), medidas
    print("Logo listo:", ", ".join(p.name for p in sorted(AQUI.glob("chocosys*"))))


if __name__ == "__main__":
    main()
