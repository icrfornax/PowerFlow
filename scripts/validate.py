"""Tuersteher vor dem Deploy. Prueft Dateien, Einbindungen und Zahlen.

Aufruf:  python scripts/validate.py
         python scripts/validate.py --negativtests

Ohne Argument: prueft das Repository und gibt bei jedem Fehler den Exit-Code 1
zurueck. Mit --negativtests: verfaelscht jede Pruefgroesse im Speicher und
weist nach, dass die zugehoerige Pruefung anschlaegt. Eine Pruefung, die nie
hat fehlschlagen sehen, ist keine Pruefung.

Das Skript waechst mit. Jede neue Datei und jede belegte Sachaussage auf der
Seite kommt hier hinein.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent

# Jede Datei, die auf der Seite landet oder von ihr geladen wird.
# Diese Liste muss mit dem paths-Filter des Deploy-Workflows uebereinstimmen.
PFLICHTDATEIEN = [
    "index.html",
    "assets/powerflow.css",
    "assets/powerflow.js",
    "data/tagesbilanz.json",
    "data/kraftwerke.json",
    "data/meta.json",
]

# Bausteine, die die index.html einbinden MUSS.
PFLICHT_IN_INDEX = [
    "assets/powerflow.css",
    "assets/powerflow.js",
    'id="powerflow-anker"',
]

# Sachaussagen, die auf der Seite stehen muessen. Sie sind belegt und duerfen
# nicht stillschweigend verschwinden.
PFLICHT_IN_JS = [
    "Bundesnetzagentur | SMARD.de",          # geforderte Namensnennung
    "CC BY 4.0",                              # Lizenz
    "kein Regler",                            # Kennzeichnung gemessener Werte
    "543/2013",                               # Grund, warum Zonenfluesse fehlen
    "23c",                                    # Grund, warum Leitungsfluesse fehlen
    "Konsistenzprüfung",                      # SMARD vs Energy-Charts
]

# Toleranzen der Selbstkontrollen.
GRENZE_BILANZREST_PROZENT = 0.5      # Erzeugung + Import - Export - Netzlast
GRENZE_ZONEN_ABWEICHUNG_MWH = 10.0   # Summe der 4 Regelzonen gegen Region DE
GRENZE_RESIDUAL_ABWEICHUNG_MWH = 5.0  # nachgerechnete gegen gelieferte Residuallast

# Plausibilitaetsrahmen fuer Kraftwerkskoordinaten: lat_min, lat_max, lon_min,
# lon_max. Die Untergrenze liegt bei 46,5 und nicht bei 47,0, weil die Werke der
# Vorarlberger Illwerke in Oesterreich liegen und dennoch zur deutschen
# Regelzone TransnetBW gehoeren. Das ist kein Datenfehler, sondern die
# tatsaechliche Ausdehnung der Regelzone.
RAHMEN = (46.5, 55.5, 5.5, 15.5)


class Befund:
    def __init__(self) -> None:
        self.fehler: list[str] = []
        self.ok: list[str] = []

    def pruefe(self, bedingung: bool, text: str) -> None:
        (self.ok if bedingung else self.fehler).append(text)


def lade(pfad: str) -> str:
    return (WURZEL / pfad).read_text(encoding="utf-8")


def ohne_kommentare(js: str) -> str:
    """Entfernt /* */- und //-Kommentare aus JavaScript.

    Bewusst einfach gehalten: Strings mit // darin werden nicht beruecksichtigt.
    Das reicht, weil hier nur nach verbotenen Bezeichnern gesucht wird und ein
    zu VIEL entfernter Text die Pruefung nur strenger, nie laxer macht.
    """
    js = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    js = re.sub(r"(?m)//.*$", " ", js)
    return js


def pruefe_alles(bilanz: dict, index_html: str, js: str, kraftwerke: dict) -> Befund:
    b = Befund()

    for name in PFLICHTDATEIEN:
        b.pruefe((WURZEL / name).is_file(), f"Datei vorhanden: {name}")

    for baustein in PFLICHT_IN_INDEX:
        b.pruefe(baustein in index_html, f"index.html bindet ein: {baustein}")

    for aussage in PFLICHT_IN_JS:
        b.pruefe(aussage in js, f"Seitentext enthaelt: {aussage!r}")

    # Cache-Buster an CSS und JS, Form ?v=JJJJMMTT-stichwort.
    treffer = re.findall(r'(?:powerflow\.(?:css|js))\?v=(\d{8}-[a-z0-9-]+)', index_html)
    b.pruefe(len(treffer) == 2, "Cache-Buster an CSS und JS vorhanden")
    b.pruefe(len(set(treffer)) <= 1, "Cache-Buster an CSS und JS identisch")

    # Fuer die naechsten Pruefungen zaehlt nur echter Code. Die Kommentare des
    # Moduls erklaeren ausdruecklich, warum toISOString und localStorage nicht
    # benutzt werden -- eine Textsuche ueber die ganze Datei wuerde daran
    # haengenbleiben und immer anschlagen.
    code = ohne_kommentare(js)
    # toISOString() verschiebt in Europa den Tag. Darf im Modul nicht vorkommen.
    b.pruefe("toISOString" not in code, "kein toISOString() im Modulcode")
    # Kein localStorage: aller Zustand kommt aus den Dateien.
    b.pruefe("localStorage" not in code, "kein localStorage im Modulcode")
    # Keine globale Bindung: das Modul ist als IIFE gekapselt.
    b.pruefe(js.lstrip().startswith("/*") and "(function ()" in js,
             "Modul ist als IIFE gekapselt")

    # --- Zahlen ---
    rest = abs(bilanz["bilanzrest_prozent"])
    b.pruefe(rest <= GRENZE_BILANZREST_PROZENT,
             f"Bilanzrest {rest:.3f} % <= {GRENZE_BILANZREST_PROZENT} %")

    k = bilanz["kontrolle"]
    b.pruefe(abs(k["abweichung_last_mwh"]) <= GRENZE_ZONEN_ABWEICHUNG_MWH,
             f"Regelzonen-Last stimmt mit Region DE ueberein "
             f"({k['abweichung_last_mwh']:+.2f} MWh)")
    b.pruefe(abs(k["abweichung_erzeugung_mwh"]) <= GRENZE_ZONEN_ABWEICHUNG_MWH,
             f"Regelzonen-Erzeugung stimmt mit Region DE ueberein "
             f"({k['abweichung_erzeugung_mwh']:+.2f} MWh)")
    b.pruefe(abs(k["residuallast_abweichung_mwh"]) <= GRENZE_RESIDUAL_ABWEICHUNG_MWH,
             f"Residuallast nachgerechnet stimmt "
             f"({k['residuallast_abweichung_mwh']:+.2f} MWh)")

    # Groessenordnung: die mittlere Leistung Deutschlands liegt zwischen
    # 30 und 90 GW. Faengt einen Faktor 1000 sofort ab.
    mw = bilanz["mittlere_leistung_mw"]
    b.pruefe(30_000 <= mw <= 90_000,
             f"Groessenordnung mittlere Leistung {mw/1000:.1f} GW liegt zwischen 30 und 90 GW")

    b.pruefe(len(bilanz["regelzonen"]) == 4, "vier Regelzonen vorhanden")
    b.pruefe(len(bilanz["aussenhandel"]) >= 10,
             f"Aussenhandel fuer {len(bilanz['aussenhandel'])} Laender vorhanden")

    # --- Kraftwerksstammdaten ---
    # Der Endpunkt ist undokumentiert. Deshalb wird die Struktur geprueft,
    # nicht nur die Existenz der Datei.
    anlagen = kraftwerke.get("anlagen", [])
    b.pruefe(len(anlagen) > 400, f"Kraftwerksstammdaten: {len(anlagen)} Anlagen")
    ohne = [a for a in anlagen if a.get("lat") is None or a.get("lon") is None]
    b.pruefe(not ohne, f"alle Anlagen haben Koordinaten ({len(ohne)} ohne)")
    # Nur Anlagen mit Koordinate. Fehlende Koordinaten faengt die Pruefung
    # darueber ab; hier duerfen sie die Rahmenpruefung nicht zum Absturz
    # bringen -- ein Tuersteher muss melden, nicht umfallen.
    mit_koord = [a for a in anlagen if a.get("lat") is not None and a.get("lon") is not None]
    ausserhalb = [a for a in mit_koord
                  if not (RAHMEN[0] <= a["lat"] <= RAHMEN[1]
                          and RAHMEN[2] <= a["lon"] <= RAHMEN[3])]
    b.pruefe(not ausserhalb,
             f"alle Koordinaten liegen im Plausibilitaetsrahmen ({len(ausserhalb)} ausserhalb)")

    # Belegte Sachaussage: die deutschen Regelzonen reichen ueber die
    # Staatsgrenze. Vianden in Luxemburg gehoert zu Amprion, die Werke in
    # Vorarlberg und im Aargau zu TransnetBW, Silz und Kuehtai in Tirol zu
    # TenneT. Wer diese Anlagen kuenftig herausfiltert, weil sie "nicht in
    # Deutschland liegen", verfaelscht die Regelzonenbilanz. Der Fall wird
    # deshalb hier festgehalten, statt stillschweigend geglaettet zu werden.
    b.pruefe(all("staat" in a for a in anlagen),
             "Feld staat ist in den Kraftwerksstammdaten vorhanden")
    ausland = [a for a in anlagen if a.get("staat") and a["staat"] != "Deutschland"]
    b.pruefe(bool(ausland),
             f"Anlagen ausserhalb Deutschlands sind erfasst ({len(ausland)} Stueck, "
             f"{sum(a['leistung_mw'] or 0 for a in ausland):,.0f} MW)")
    b.pruefe(all(a["regelzone"] in {"50Hertz", "TenneT", "Amprion", "TransnetBW"}
                 for a in ausland),
             "jede Anlage im Ausland ist einer deutschen Regelzone zugeordnet")
    zonen = {a.get("regelzone") for a in anlagen}
    b.pruefe(zonen == {"50Hertz", "TenneT", "Amprion", "TransnetBW"},
             f"Anlagen decken genau die vier Regelzonen ab: {sorted(x for x in zonen if x)}")

    return b


def negativtests() -> int:
    """Verfaelscht jede Pruefgroesse und weist nach, dass die Pruefung anschlaegt."""
    bilanz = json.loads(lade("data/tagesbilanz.json"))
    index_html = lade("index.html")
    js = lade("assets/powerflow.js")
    kraftwerke = json.loads(lade("data/kraftwerke.json"))

    grund = pruefe_alles(bilanz, index_html, js, kraftwerke)
    if grund.fehler:
        print("Die Negativtests brauchen einen sauberen Ausgangszustand, aber es gibt Fehler:")
        for f in grund.fehler:
            print("  FEHLT:", f)
        return 1

    import copy

    faelle = [
        ("Cache-Buster entfernt",
         lambda: (bilanz, index_html.replace("?v=20260830-rumpf", ""), js, kraftwerke)),
        ("Anker aus index.html entfernt",
         lambda: (bilanz, index_html.replace('id="powerflow-anker"', 'id="weg"'), js, kraftwerke)),
        ("Namensnennung aus dem Modul entfernt",
         lambda: (bilanz, index_html, js.replace("Bundesnetzagentur | SMARD.de", "irgendwer"), kraftwerke)),
        ("toISOString() ins Modul geschmuggelt",
         lambda: (bilanz, index_html, js + "\nvar x = new Date().toISOString();", kraftwerke)),
        ("localStorage ins Modul geschmuggelt",
         lambda: (bilanz, index_html, js + "\nlocalStorage.setItem('a','b');", kraftwerke)),
        ("Bilanzrest verfaelscht",
         lambda: (_mit(bilanz, "bilanzrest_prozent", 7.5), index_html, js, kraftwerke)),
        ("Regelzonensumme verfaelscht",
         lambda: (_mit_kontrolle(bilanz, "abweichung_last_mwh", 5000.0), index_html, js, kraftwerke)),
        ("Residuallast verfaelscht",
         lambda: (_mit_kontrolle(bilanz, "residuallast_abweichung_mwh", 900.0), index_html, js, kraftwerke)),
        ("Faktor 1000 bei der Leistung",
         lambda: (_mit(bilanz, "mittlere_leistung_mw", 50.4), index_html, js, kraftwerke)),
        ("Kraftwerk ohne Koordinate",
         lambda: (bilanz, index_html, js, _ohne_koordinate(kraftwerke))),
        ("Kraftwerk ausserhalb Deutschlands",
         lambda: (bilanz, index_html, js, _verschoben(kraftwerke))),
        ("Eine Regelzone fehlt",
         lambda: (_ohne_zone(bilanz), index_html, js, kraftwerke)),
    ]

    print("Negativtests -- jede Pruefung muss bei verfaelschter Eingabe anschlagen.")
    print()
    misslungen = 0
    for name, mach in faelle:
        b1, h1, j1, k1 = mach()
        befund = pruefe_alles(b1, h1, j1, k1)
        schlug_an = bool(befund.fehler)
        print(f"  [{'ok   ' if schlug_an else 'PROBL'}] {name}"
              + ("" if schlug_an else "  <-- Pruefung hat NICHT angeschlagen"))
        if not schlug_an:
            misslungen += 1
    print()
    if misslungen:
        print(f"{misslungen} Negativtest(s) ohne Wirkung. Die Pruefung ist luekenhaft.")
        return 1
    print(f"Alle {len(faelle)} Negativtests haben angeschlagen.")
    return 0


def _mit(bilanz: dict, feld: str, wert) -> dict:
    import copy
    k = copy.deepcopy(bilanz)
    k[feld] = wert
    return k


def _mit_kontrolle(bilanz: dict, feld: str, wert) -> dict:
    import copy
    k = copy.deepcopy(bilanz)
    k["kontrolle"][feld] = wert
    return k


def _ohne_zone(bilanz: dict) -> dict:
    import copy
    k = copy.deepcopy(bilanz)
    k["regelzonen"] = k["regelzonen"][:3]
    return k


def _ohne_koordinate(kw: dict) -> dict:
    import copy
    k = copy.deepcopy(kw)
    k["anlagen"][0]["lat"] = None
    return k


def _verschoben(kw: dict) -> dict:
    import copy
    k = copy.deepcopy(kw)
    k["anlagen"][0]["lat"] = 41.9
    k["anlagen"][0]["lon"] = 12.5
    return k


def main(argv: list[str]) -> int:
    if "--negativtests" in argv:
        return negativtests()

    fehlend = [n for n in PFLICHTDATEIEN if not (WURZEL / n).is_file()]
    if fehlend:
        for n in fehlend:
            print("FEHLER: Datei fehlt:", n)
        return 1

    befund = pruefe_alles(
        json.loads(lade("data/tagesbilanz.json")),
        lade("index.html"),
        lade("assets/powerflow.js"),
        json.loads(lade("data/kraftwerke.json")),
    )
    for t in befund.ok:
        print("  ok    ", t)
    for t in befund.fehler:
        print("  FEHLER", t)
    print()
    if befund.fehler:
        print(f"{len(befund.fehler)} Fehler. Kein Deploy.")
        return 1
    print(f"Alle {len(befund.ok)} Pruefungen bestanden.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
