"""Baut data/grundkarte.json aus Natural Earth.

Aufruf:  python scripts/fetch-grundkarte.py

Das ist ein EINMAL-SKRIPT, kein Teil der taeglichen Abrufkette. Die Geometrie
aendert sich nicht taeglich; die erzeugte Datei liegt im Repository und wird
nur neu gebaut, wenn es einen Grund gibt. Der Rohdatensatz ist rund 40 MB gross
und wird bewusst NICHT ins Repository gelegt.

Quelle und Lizenz
-----------------
Natural Earth, https://www.naturalearthdata.com/
Gemeinfrei. Die Nutzungsbedingungen sagen woertlich: "All versions of Natural
Earth raster and vector map data found on this website are in the public
domain. You may use the maps in any manner, including modifying the content
and design, electronic dissemination, and offset printing. The primary authors,
Tom Patterson and Nathaniel Vaughn Kelso, and all other contributors renounce
all financial claim to the maps and invite you to use them for personal,
educational, and commercial purposes."

Damit ist die Grundkarte lizenzrechtlich unbedenklich -- anders als
OSM-abgeleitete Geometrie (ODbL, Share-alike) oder Kartenkacheln fremder
Anbieter. Es werden KEINE fremden Kartenkacheln geladen; die Seite zeichnet die
Geometrie selbst als SVG.

Vereinfachung
-------------
Ramer-Douglas-Peucker, in Grad. Die Toleranz ist so gewaehlt, dass die Datei
klein bleibt und der Umriss bei der Darstellungsgroesse der Seite nicht
sichtbar leidet. Die Vereinfachung wird im Kopf der Datei genannt -- eine
vereinfachte Grenze ist eine Naeherung und keine Messung.
"""

from __future__ import annotations

import json
import math
import pathlib
import urllib.request

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "grundkarte.json"

BASIS = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
STAATEN = BASIS + "ne_50m_admin_0_countries.geojson"
LAENDER = BASIS + "ne_10m_admin_1_states_provinces.geojson"

# Nachbarn als leiser Zusammenhang. Die Namen stammen aus dem Feld ADMIN.
NACHBARN = [
    "Denmark", "Poland", "Czechia", "Austria", "Switzerland",
    "France", "Luxembourg", "Belgium", "Netherlands",
]

TOLERANZ_LAND = 0.008     # Bundeslaender, rund 600 m
TOLERANZ_NACHBAR = 0.030  # Nachbarstaaten, gröber -- sie sind nur Kontext
RAHMEN = (3.0, 18.0, 45.0, 57.5)  # lon_min, lon_max, lat_min, lat_max


def lade(url: str) -> dict:
    print(f"  lade {url.rsplit('/', 1)[-1]} ...", flush=True)
    with urllib.request.urlopen(url, timeout=300) as a:
        roh = a.read()
    print(f"    {len(roh):,} Bytes")
    return json.loads(roh.decode("utf-8"))


def abstand(p, a, b) -> float:
    """Senkrechter Abstand des Punktes p von der Strecke a-b, in Grad."""
    if a == b:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def rdp(punkte: list, toleranz: float) -> list:
    if len(punkte) < 3:
        return punkte
    weit, index = 0.0, 0
    for i in range(1, len(punkte) - 1):
        d = abstand(punkte[i], punkte[0], punkte[-1])
        if d > weit:
            weit, index = d, i
    if weit <= toleranz:
        return [punkte[0], punkte[-1]]
    return rdp(punkte[:index + 1], toleranz)[:-1] + rdp(punkte[index:], toleranz)


def ringe(geometrie: dict) -> list[list]:
    """Alle Aussenringe einer (Multi)Polygon-Geometrie."""
    art = geometrie["type"]
    if art == "Polygon":
        return [geometrie["coordinates"][0]]
    if art == "MultiPolygon":
        return [teil[0] for teil in geometrie["coordinates"]]
    return []


def im_rahmen(ring: list) -> bool:
    return any(RAHMEN[0] <= x <= RAHMEN[1] and RAHMEN[2] <= y <= RAHMEN[3]
               for x, y in ring)


def aufbereiten(geometrie: dict, toleranz: float, mindestpunkte: int = 6) -> list[list]:
    raus = []
    for ring in ringe(geometrie):
        if not im_rahmen(ring):
            continue
        einfach = rdp([[round(x, 4), round(y, 4)] for x, y in ring], toleranz)
        if len(einfach) >= mindestpunkte:
            raus.append(einfach)
    return raus


def main() -> int:
    import sys
    sys.setrecursionlimit(20000)

    staaten = lade(STAATEN)
    laender = lade(LAENDER)

    nachbarn = []
    for f in staaten["features"]:
        name = f["properties"].get("ADMIN")
        if name in NACHBARN:
            teile = aufbereiten(f["geometry"], TOLERANZ_NACHBAR, mindestpunkte=8)
            if teile:
                nachbarn.append({"name": name, "ringe": teile})

    bundeslaender = []
    for f in laender["features"]:
        p = f["properties"]
        if p.get("admin") != "Germany":
            continue
        teile = aufbereiten(f["geometry"], TOLERANZ_LAND)
        if teile:
            bundeslaender.append({"name": p.get("name"), "ringe": teile})

    doc = {
        "_quelle": "Natural Earth, https://www.naturalearthdata.com/",
        "_lizenz": "gemeinfrei (public domain), keine Namensnennung gefordert",
        "_hinweis": (
            "Vereinfachte Geometrie. Ramer-Douglas-Peucker mit Toleranz "
            f"{TOLERANZ_LAND} Grad fuer Bundeslaender und {TOLERANZ_NACHBAR} Grad "
            "fuer Nachbarstaaten. Eine vereinfachte Grenze ist eine Naeherung und "
            "keine Messung; sie dient nur der Orientierung. Koordinaten in der "
            "GeoJSON-Reihenfolge [Laenge, Breite]."
        ),
        "rahmen": {"lon_min": RAHMEN[0], "lon_max": RAHMEN[1],
                   "lat_min": RAHMEN[2], "lat_max": RAHMEN[3]},
        "bundeslaender": sorted(bundeslaender, key=lambda x: x["name"] or ""),
        "nachbarn": sorted(nachbarn, key=lambda x: x["name"]),
    }
    ZIEL.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")

    punkte_l = sum(len(r) for b in bundeslaender for r in b["ringe"])
    punkte_n = sum(len(r) for b in nachbarn for r in b["ringe"])
    print(f"  Bundeslaender: {len(bundeslaender)}, {punkte_l:,} Punkte")
    print(f"  Nachbarstaaten: {len(nachbarn)}, {punkte_n:,} Punkte")
    print(f"  geschrieben: data/grundkarte.json  ({ZIEL.stat().st_size:,} Bytes)")
    for b in doc["bundeslaender"]:
        print(f"    {b['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
