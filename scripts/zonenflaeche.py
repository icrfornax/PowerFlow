"""Leitet die Flaeche der vier Regelzonen ab und misst, wie gut das gelingt.

Aufruf:  python scripts/zonenflaeche.py
         python scripts/zonenflaeche.py --nur-pruefen

DAS HIER IST KEINE MESSUNG. Es ist die einzige Stelle im Projekt, an der eine
Geometrie abgeleitet statt gemessen wird, und sie steht deshalb unter eigenen
Auflagen:

1. Eine amtliche oder offene Geometrie der Regelzonen gibt es nicht. Overpass
   liefert fuer Grenzrelationen der vier UeNB null Treffer; die
   Bundesnetzagentur veroeffentlicht eine Netzkarte als PDF, keine Geodaten.
   Beleg: docs/beleg-regelzonenflaeche.md.
2. Die Flaeche wird aus BELEGTEN Stuetzpunkten interpoliert -- Kraftwerke mit
   amtlicher Zonenangabe und Leitungen mit eindeutigem Betreiber.
3. Die Trefferquote wird gemessen und mitgeliefert. Sie steht auf der Seite,
   nicht im Kleingedruckten.
4. Die Ebene ist auf der Karte VOREINGESTELLT AUS und ausdruecklich als
   abgeleitet beschriftet.

Wer 2. bis 4. aufweicht, macht aus einer benannten Naeherung eine behauptete
Grenze. Dann lieber die Ebene loeschen.
"""

from __future__ import annotations

import collections
import json
import math
import pathlib
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"
ZIEL = DATA / "regelzonen-flaeche.json"

ZONEN = ["50Hertz", "Amprion", "TenneT", "TransnetBW"]

# OSM-Betreibername -> Regelzone. Bewusst NICHT dabei: "RWE" (historischer
# Vorgaenger von Amprion -- die Gleichsetzung waere eine Annahme, und Annahmen
# gehoeren nicht unbemerkt in die Stuetzpunkte) und alles mit Semikolon
# (mehrere Betreiber, nicht eindeutig).
OSM_BETREIBER = {
    "50Hertz": "50Hertz",
    "50Hertz Transmission": "50Hertz",
    "50Hertz Transmission GmbH": "50Hertz",
    "Amprion": "Amprion",
    "Amprion GmbH": "Amprion",
    "TenneT": "TenneT",
    "TenneT TSO": "TenneT",
    "TenneT TSO GmbH": "TenneT",
    "TransnetBW": "TransnetBW",
    "TransnetBW GmbH": "TransnetBW",
}

# Rasterweite der Flaeche. 0,02 Grad sind rund 1,5 mal 2,2 km -- bei der
# Zoomstufe der Deutschlandkarte etwa ein Bildpunkt, die Treppe ist also nicht
# zu sehen. Feiner waere nur teurer, nicht genauer: die Stuetzpunkte stehen
# viel weiter auseinander.
RASTER = 0.02
# Ausduennung der Leitungsstuetzpunkte. Ohne sie gewinnt die Zone mit den
# meisten Knoten in einem Leitungszug, nicht die naechstgelegene.
AUSDUENNUNG = 0.05
# Weiter als das vom naechsten Stuetzpunkt wird nichts mehr zugeordnet. Eine
# Ecke ohne Hoechstspannungsnetz bleibt leer, statt geraten zu werden.
MAX_KM = 60.0


def lies(pfad: pathlib.Path):
    return json.loads(pfad.read_text(encoding="utf-8"))


def stuetzpunkte():
    """Punkte mit belegter Zonenzugehoerigkeit."""
    anlagen = []
    for a in lies(DATA / "kraftwerke.json")["anlagen"]:
        if a.get("regelzone") in ZONEN and a.get("lat") and a.get("lon"):
            anlagen.append((float(a["lon"]), float(a["lat"]), a["regelzone"]))

    roh = []
    for o in lies(DATA / "netz-hoechstspannung.json")["objekte"]:
        zone = OSM_BETREIBER.get(o.get("b"))
        if not zone:
            continue
        for lon, lat in o["p"]:
            roh.append((float(lon), float(lat), zone))

    # Ausduennen: je Rasterzelle die dort haeufigste Zone, ein Punkt.
    eimer: dict = {}
    for lon, lat, z in roh:
        schluessel = (round(lon / AUSDUENNUNG), round(lat / AUSDUENNUNG))
        eimer.setdefault(schluessel, collections.Counter())[z] += 1
    leitungen = [(gx * AUSDUENNUNG, gy * AUSDUENNUNG, c.most_common(1)[0][0])
                 for (gx, gy), c in eimer.items()]
    return anlagen, leitungen, len(roh)


class Index:
    """Grobes Gitter ueber die Stuetzpunkte, damit die Suche nicht linear ist."""

    WEITE = 0.25

    def __init__(self, punkte):
        self.punkte = punkte
        self.zellen: dict = {}
        for i, (lon, lat, _) in enumerate(punkte):
            self.zellen.setdefault(
                (int(math.floor(lon / self.WEITE)), int(math.floor(lat / self.WEITE))),
                []).append(i)

    def naechster(self, lon, lat, ausser=None):
        """Naechster Stuetzpunkt in km. Ringe wachsen, bis der Fund sicher ist."""
        kb = math.cos(math.radians(lat))
        gx, gy = int(math.floor(lon / self.WEITE)), int(math.floor(lat / self.WEITE))
        bester, beste = None, float("inf")
        ring = 0
        while ring < 40:
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    # Nur der neue Rand des Rings, das Innere war schon dran.
                    if ring and max(abs(dx), abs(dy)) != ring:
                        continue
                    for i in self.zellen.get((gx + dx, gy + dy), ()):
                        if i == ausser:
                            continue
                        plon, plat, z = self.punkte[i]
                        a = (plon - lon) * kb
                        b = plat - lat
                        d = a * a + b * b
                        if d < beste:
                            beste, bester = d, z
            # Ein Fund im Ring r ist erst sicher, wenn der naechste Ring nicht
            # mehr naeher liegen kann.
            if bester is not None and math.sqrt(beste) <= ring * self.WEITE:
                break
            ring += 1
        return bester, math.sqrt(beste) * 111.0 if bester is not None else None


def im_polygon(lon, lat, ringe):
    """Strahlenmethode. Loecher zaehlen mit und heben sich dadurch auf."""
    drin = False
    for ring in ringe:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat):
                if lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                    drin = not drin
            j = i
    return drin


def deutschland():
    """Bundeslaender mit Umschliessendem, damit die Pruefung schnell bleibt."""
    laender = []
    for b in lies(DATA / "grundkarte.json")["bundeslaender"]:
        ringe = [[(float(x), float(y)) for x, y in r] for r in b["ringe"]]
        xs = [p[0] for r in ringe for p in r]
        ys = [p[1] for r in ringe for p in r]
        laender.append((min(xs), min(ys), max(xs), max(ys), ringe))
    return laender


def in_deutschland(lon, lat, laender):
    for x0, y0, x1, y1, ringe in laender:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and im_polygon(lon, lat, ringe):
            return True
    return False


def kreuzprobe(anlagen, index_ohne_anlagen_baum, alle):
    """Jedes Kraftwerk aus den UEBRIGEN Stuetzpunkten vorhersagen.

    Das ist die einzige ehrliche Note fuer diese Flaeche: sie sagt, wie oft die
    Interpolation die amtliche Zonenangabe trifft, wenn sie den Punkt selbst
    nicht kennt.
    """
    index = Index(alle)
    treffer = 0
    verwechselt = collections.Counter()
    daneben = []
    for k, (lon, lat, wahr) in enumerate(anlagen):
        # Die Anlagen stehen hinten in `alle`, ihr Index ist also versetzt.
        i = index_ohne_anlagen_baum + k
        gelesen, _ = index.naechster(lon, lat, ausser=i)
        if gelesen == wahr:
            treffer += 1
        else:
            verwechselt[wahr + " als " + str(gelesen)] += 1
            daneben.append({"lon": round(lon, 4), "lat": round(lat, 4),
                            "zone": wahr, "gelesen": gelesen})
    return treffer, verwechselt, daneben


def laeufe(zellen, lat_werte, lon0, lon_anzahl):
    """Gleiche Zellen einer Zeile zu einem Rechteck zusammenfassen.

    Aus rund 150.000 Zellen werden so einige tausend Rechtecke. Sie stossen
    exakt aneinander und ergeben im Bild eine geschlossene Flaeche.
    """
    raus = {z: [] for z in ZONEN}
    for zeile, lat in enumerate(lat_werte):
        laufend, start = None, 0
        for spalte in range(lon_anzahl + 1):
            hier = zellen.get((spalte, zeile)) if spalte < lon_anzahl else None
            if hier != laufend:
                if laufend is not None:
                    raus[laufend].append([
                        round(lon0 + start * RASTER, 4), round(lat, 4),
                        round((spalte - start) * RASTER, 4)])
                laufend, start = hier, spalte
    return raus


def main(nur_pruefen: bool = False) -> int:
    anlagen, leitungen, roh = stuetzpunkte()
    alle = leitungen + anlagen
    print(f"  Kraftwerke mit amtlicher Zone   : {len(anlagen)}")
    print(f"  Leitungsknoten mit Betreiber    : {roh}, ausgeduennt auf {len(leitungen)}")
    print(f"  Stuetzpunkte gesamt             : {len(alle)}")

    treffer, verwechselt, daneben = kreuzprobe(anlagen, len(leitungen), alle)
    quote = treffer / len(anlagen) * 100
    print(f"\n  Kreuzprobe: {treffer} von {len(anlagen)} Kraftwerken richtig "
          f"({quote:.1f} %), {len(anlagen) - treffer} daneben")
    for k, v in verwechselt.most_common():
        print(f"     {v:3d}x  {k}")
    if quote < 85:
        print("\n  ABBRUCH: unter 85 % trifft die Flaeche zu oft daneben, um sie zu zeigen.")
        return 1
    if nur_pruefen:
        return 0

    laender = deutschland()
    xs = [x for x0, _, x1, _, _ in ((a, b, c, d, e) for a, b, c, d, e in laender)
          for x in (x0, x1)]
    ys = [y for _, y0, _, y1, _ in laender for y in (y0, y1)]
    lon0 = math.floor(min(xs) / RASTER) * RASTER
    lon1 = math.ceil(max(xs) / RASTER) * RASTER
    lat0 = math.floor(min(ys) / RASTER) * RASTER
    lat1 = math.ceil(max(ys) / RASTER) * RASTER
    lon_anzahl = int(round((lon1 - lon0) / RASTER))
    lat_werte = [lat0 + i * RASTER for i in range(int(round((lat1 - lat0) / RASTER)) + 1)]

    index = Index(alle)
    zellen = {}
    zuweit = 0
    for zeile, lat in enumerate(lat_werte):
        for spalte in range(lon_anzahl):
            lon = lon0 + spalte * RASTER
            if not in_deutschland(lon + RASTER / 2, lat + RASTER / 2, laender):
                continue
            zone, km = index.naechster(lon + RASTER / 2, lat + RASTER / 2)
            if zone is None or km > MAX_KM:
                zuweit += 1
                continue
            zellen[(spalte, zeile)] = zone
    print(f"\n  Zellen in Deutschland zugeordnet: {len(zellen)} "
          f"(Rasterweite {RASTER} Grad), {zuweit} zu weit vom naechsten Punkt")

    balken = laeufe(zellen, lat_werte, lon0, lon_anzahl)
    for z in ZONEN:
        print(f"     {z:<12} {len(balken[z]):>5} Rechtecke")

    doc = {
        "_hinweis": (
            "ABGELEITET, KEINE MESSUNG. Eine amtliche oder offene Geometrie der "
            "vier Regelzonen gibt es nicht -- OpenStreetMap fuehrt keine "
            "Grenzrelationen dafuer, die Bundesnetzagentur veroeffentlicht eine "
            "Netzkarte als PDF. Diese Flaeche ist interpoliert: jede Rasterzelle "
            "bekommt die Regelzone ihres naechstgelegenen Stuetzpunktes. "
            "Stuetzpunkte sind Kraftwerke mit amtlicher Zonenangabe und "
            "Hoechstspannungsleitungen mit eindeutigem Betreiber. Das ist eine "
            "Naeherung und keine Grenze; die gemessene Trefferquote steht in "
            "diesem Dokument und auf der Seite."),
        "_quelle": "abgeleitet aus data/kraftwerke.json (SMARD, Bundesnetzagentur) "
                   "und data/netz-hoechstspannung.json (OpenStreetMap, ODbL 1.0)",
        "_namensnennung": "Bundesnetzagentur | SMARD.de; © OpenStreetMap contributors",
        "_share_alike": ("Enthaelt eine Ableitung aus OpenStreetMap-Daten. Die ODbL "
                         "verlangt Namensnennung und Share-alike fuer abgeleitete "
                         "Datenbanken."),
        "verfahren": (f"Raster {RASTER} Grad, naechster Stuetzpunkt gewinnt, "
                      f"hoechstens {MAX_KM:.0f} km Entfernung, auf die "
                      f"Bundeslandumrisse beschnitten."),
        "stuetzpunkte": {"kraftwerke": len(anlagen), "leitungsknoten": len(leitungen),
                         "gesamt": len(alle)},
        "kreuzprobe": {
            "geprueft": len(anlagen), "richtig": treffer,
            "quote_prozent": round(quote, 1),
            "verwechselt": dict(verwechselt),
            "erlaeuterung": ("Fuer jedes der Kraftwerke wurde die Regelzone aus den "
                             "uebrigen Stuetzpunkten vorhergesagt und mit der "
                             "amtlichen Angabe verglichen."),
        },
        "daneben": daneben,
        "raster": RASTER,
        "zonen": {z: balken[z] for z in ZONEN},
        "format": "je Zone eine Liste [lon_links, lat_unten, breite_in_grad]; "
                  "die Hoehe ist immer die Rasterweite",
    }
    ZIEL.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    print(f"\n  geschrieben: {ZIEL.relative_to(WURZEL)} "
          f"({ZIEL.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main("--nur-pruefen" in sys.argv))
