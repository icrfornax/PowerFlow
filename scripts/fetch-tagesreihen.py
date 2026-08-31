"""Holt die SMARD-Tagesreihen als Jahresdateien nach data/tage/.

Aufruf:  python scripts/fetch-tagesreihen.py            (alle Jahre ab 2015)
         python scripts/fetch-tagesreihen.py 2025 2026   (nur diese Jahre)

Hintergrund
-----------
Die freie Variable der Seite ist der Kalendertag. Die Seite braucht deshalb
Tageswerte fuer viele Tage, nicht fuer einen. SMARD bietet dafuer die
Aufloesung "day": ein Abruf je Filter und Jahr statt 52 je Woche.

Die Tagesauflösung wurde gegen die eigene Viertelstundenreihe geprueft:
  Netzlast 19.08.2026, day-Aufloesung   1.209.350,67 MWh
  Summe der 96 Viertelstundenwerte      1.209.350,65 MWh
  Differenz                                      0,02 MWh
Das ist Rundung. Die day-Reihe ist dieselbe Groesse, nur vorsummiert.

Je Jahr entsteht eine Datei data/tage/<jahr>.json. Die Seite laedt das Jahr des
gewaehlten Tages und das Vorjahr -- mehr nicht. So bleibt die Seite schnell,
obwohl zwoelf Jahre im Repository liegen.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "tage"

ERSTES_JAHR = 2015

# Grosshandelspreis Deutschland/Luxemburg, Day-Ahead. In der Tagesaufloesung
# liefert SMARD das MITTEL der 24 Stundenpreise, nicht ihre Summe -- geprueft
# am 24.08.2026: Tageswert 143,18, Mittel der Stunden 143,18, Summe 3.436,43.
# Die Reihe beginnt am 01.10.2018, dem Tag der Teilung der Gebotszone
# Deutschland-Oesterreich-Luxemburg.
PREIS_FILTER = 4169


def jahresbloecke() -> dict[int, int]:
    """Jahr -> Zeitstempel des Jahresblocks, aus dem Index der Netzlast."""
    return {
        dt.datetime.fromtimestamp(t / 1000, smard.TZ).year: t
        for t in smard.wochenbloecke(smard.LAST_NETZLAST, smard.REGION_DE, "day")
    }


def hole(filter_id: int, region: str, block: int) -> dict[str, float] | None:
    """Tageswerte eines Jahres als {ISO-Datum: Wert}. None bei HTTP 404."""
    try:
        paare = smard.reihe(filter_id, region, "day", block)
    except smard.Nichtvorhanden:
        return None
    return {
        dt.datetime.fromtimestamp(t / 1000, smard.TZ).date().isoformat(): v
        for t, v in paare
    }


# Plausibilitaetsgrenzen je Tageswert, in MWh.
#
# Kuppelstelle: kein deutscher Grenzquerschnitt uebertraegt dauerhaft mehr als
# rund 10 GW; 10 GW x 24 h = 240 GWh. Grenze grosszuegig bei 400 GWh.
# Netzlast: die mittlere Leistung Deutschlands liegt zwischen 30 und 90 GW,
# also 720 bis 2.160 GWh am Tag.
# Ein einzelner Energietraeger einer Regelzone bleibt unter 600 GWh am Tag.
#
# Was hier anschlaegt, wird NICHT stillschweigend korrigiert. Der Wert wird auf
# null gesetzt, damit nichts damit gerechnet wird, und der Originalwert wandert
# unveraendert in die Liste "auffaellig" der Jahresdatei. Bekannter Fall:
# Schweiz-Import am 09.02.2015 mit 25.009.206 MWh -- 25 TWh an einem Tag, waehrend
# die Nachbartage bei einigen Zehntausend liegen. Ein Fehler der Quelle.
# Die Grenzen gelten je REIHENART, nicht pauschal. Ein erster Versuch mit einer
# gemeinsamen Grenze fuer alles hat 1.827 Fehlalarme erzeugt: Residuallast und
# Regelzonen-Last wurden gegen die Grenzen der deutschen Gesamtlast geprueft.
# Falsch waren die Grenzen, nicht die Daten.
GRENZEN = {
    # Import oder Export eines Nachbarlandes an einem Tag.
    "kuppelstelle": (0.0, 400_000.0),
    # Netzlast Deutschland: 30 bis 90 GW mittlere Leistung.
    "netzlast_de": (720_000.0, 2_160_000.0),
    # Netzlast einer Regelzone: TransnetBW liegt bei rund 150 GWh,
    # Amprion bei rund 580 GWh. Grosszuegig 30 bis 900 GWh.
    "netzlast_zone": (30_000.0, 900_000.0),
    # Residuallast = Netzlast minus Wind und PV. Kann an windigen, sonnigen
    # Tagen sehr klein und kuenftig auch negativ werden.
    "residuallast": (-500_000.0, 2_160_000.0),
    "pumpspeicher": (0.0, 250_000.0),
    # Ein Energietraeger deutschlandweit: Wind Onshore erreicht an Sturmtagen
    # weit ueber 600 GWh. Grenze bei 1.600 GWh.
    "traeger_de": (0.0, 1_600_000.0),
    # Derselbe Traeger innerhalb einer Regelzone.
    "traeger_zone": (0.0, 900_000.0),
    # Tagesmittel des Grosshandelspreises. Negative Preise sind echt: der
    # tiefste Stundenwert der Reihe liegt bei genau -500,00 Euro, dem frueheren
    # Preisboden der Boerse. Eine Grenze bei -500 laege also GENAU auf einem
    # echten Wert; deshalb -1000, der heutige Boden. Nach oben ebenso: der
    # hoechste Stundenwert liegt bei 936 Euro.
    "preis": (-1000.0, 1000.0),
}


def spalte(werte: dict[str, float] | None, tage: list[str],
           art: str, pfad: tuple, auffaellig: list) -> list[float | None]:
    if werte is None:
        return [None] * len(tage)
    unten, oben = GRENZEN[art]
    raus = []
    for d in tage:
        v = werte.get(d)
        if v is None:
            raus.append(None)
            continue
        if not (unten <= v <= oben):
            auffaellig.append({
                "tag": d, "reihe": "/".join(pfad), "originalwert": v,
                "grenze": [unten, oben],
                "behandlung": ("Wert als fehlend gefuehrt. Nicht korrigiert, nicht "
                               "geschaetzt -- der Originalwert steht hier."),
            })
            raus.append(None)
            continue
        raus.append(round(v, 2))
    return raus


def art_von(pfad: tuple) -> str:
    if pfad[0] == "preis_eur_mwh":
        return "preis"
    if pfad[0] == "aussenhandel":
        return "kuppelstelle"
    if pfad[0] == "residuallast":
        return "residuallast"
    if pfad[0] == "pumpspeicherverbrauch":
        return "pumpspeicher"
    if pfad[0] == "regelzonen":
        return "netzlast_zone" if pfad[-1] == "netzlast" else "traeger_zone"
    if pfad[0] == "netzlast":
        return "netzlast_de"
    return "traeger_de"


def jahr_bauen(jahr: int, block: int) -> dict:
    auftraege: list[tuple] = []
    # (Schluesselpfad, filter_id, region)
    auftraege.append((("netzlast",), smard.LAST_NETZLAST, smard.REGION_DE))
    auftraege.append((("residuallast",), smard.LAST_RESIDUAL, smard.REGION_DE))
    auftraege.append((("pumpspeicherverbrauch",), smard.LAST_PUMPSPEICHER, smard.REGION_DE))
    auftraege.append((("preis_eur_mwh",), PREIS_FILTER, smard.REGION_DE))
    for fid, name in smard.ERZEUGUNG.items():
        auftraege.append((("erzeugung", name), fid, smard.REGION_DE))
    for zone in smard.REGELZONEN:
        auftraege.append((("regelzonen", zone, "netzlast"), smard.LAST_NETZLAST, zone))
        for fid, name in smard.ERZEUGUNG.items():
            auftraege.append((("regelzonen", zone, "erzeugung", name), fid, zone))
    for land, ids in smard.AUSSENHANDEL.items():
        auftraege.append((("aussenhandel", land, "import"), ids["import"], smard.REGION_DE))
        auftraege.append((("aussenhandel", land, "export"), ids["export"], smard.REGION_DE))

    with ThreadPoolExecutor(max_workers=8) as pool:
        ergebnisse = list(pool.map(lambda a: hole(a[1], a[2], block), auftraege))

    # Die Tagesachse kommt aus der Netzlast -- sie ist die einzige Reihe, die
    # garantiert vollstaendig ist.
    netzlast = ergebnisse[0]
    if not netzlast:
        raise SystemExit(f"ABBRUCH: keine Netzlast fuer {jahr}.")
    tage = sorted(netzlast)

    doc: dict = {
        "jahr": jahr,
        "abgerufen": dt.datetime.now(smard.TZ).isoformat(timespec="seconds"),
        "quelle": "SMARD, Bundesnetzagentur",
        "lizenz": "CC BY 4.0",
        "namensnennung": "Bundesnetzagentur | SMARD.de",
        "einheit": "MWh je Tag",
        "hinweis": (
            "Tageswerte in der SMARD-Aufloesung 'day'. Gegen die eigene "
            "Viertelstundenreihe geprueft: Abweichung 0,02 MWh am 19.08.2026, "
            "also Rundung. Fehlende Werte stehen als null und werden nicht "
            "durch Null ersetzt. Maschinenlesbar mit Punkt als "
            "Dezimaltrennzeichen; die Anzeige auf der Seite ist deutsch "
            "formatiert."
        ),
        "tage": tage,
        "nicht_vorhanden": [],
        "auffaellig": [],
    }

    for (pfad, fid, region), werte in zip(auftraege, ergebnisse):
        if werte is None:
            doc["nicht_vorhanden"].append({
                "reihe": "/".join(pfad), "filter_id": fid, "region": region,
                "grund": "HTTP 404 -- Reihe existiert fuer diese Region nicht",
            })
        ziel = doc
        for teil in pfad[:-1]:
            ziel = ziel.setdefault(teil, {})
        ziel[pfad[-1]] = spalte(werte, tage, art_von(pfad), pfad, doc["auffaellig"])

    return doc


def preise_nachtragen() -> int:
    """Traegt nur den Tagespreis in die vorhandenen Jahresdateien nach.

    Eigener Lauf, weil die Reihe spaeter dazugekommen ist: neun Abrufe statt
    eines vollen Neulaufs ueber alle Reihen.
    """
    bloecke = jahresbloecke()
    for jahr, block in sorted(bloecke.items()):
        pfad = ZIEL / f"{jahr}.json"
        if not pfad.is_file():
            continue
        doc = json.loads(pfad.read_text(encoding="utf-8"))
        werte = hole(PREIS_FILTER, smard.REGION_DE, block)
        if werte is None:
            print(f"  {jahr}: kein Preis (HTTP 404)")
            continue
        auffaellig: list = []
        doc["preis_eur_mwh"] = spalte(werte, doc["tage"], "preis",
                                      ("preis_eur_mwh",), auffaellig)
        doc["auffaellig"] = doc.get("auffaellig", []) + auffaellig
        belegt = sum(1 for v in doc["preis_eur_mwh"] if v is not None)
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        print(f"  {jahr}: {belegt} Tagespreise" + (f", {len(auffaellig)} auffaellig"
                                                   if auffaellig else ""))
    return 0


def main(argv: list[str]) -> int:
    if "--preise" in argv:
        return preise_nachtragen()
    bloecke = jahresbloecke()
    jahre = [int(a) for a in argv] if argv else sorted(j for j in bloecke if j >= ERSTES_JAHR)
    ZIEL.mkdir(parents=True, exist_ok=True)

    verzeichnis = []
    for jahr in jahre:
        if jahr not in bloecke:
            print(f"  {jahr}: kein Jahresblock bei SMARD, uebersprungen")
            continue
        doc = jahr_bauen(jahr, bloecke[jahr])
        pfad = ZIEL / f"{jahr}.json"
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        belegt = sum(1 for v in doc["netzlast"] if v is not None)
        print(f"  {jahr}: {len(doc['tage'])} Tage, davon {belegt} mit Netzlast, "
              f"{len(doc['nicht_vorhanden'])} Reihen nicht vorhanden, "
              f"{len(doc['auffaellig'])} auffaellige Werte, "
              f"{pfad.stat().st_size:,} Bytes")
        for a in doc["auffaellig"]:
            print(f"      AUFFAELLIG {a['tag']} {a['reihe']}: {a['originalwert']:,.0f} MWh")
        verzeichnis.append({
            "jahr": jahr, "datei": f"data/tage/{jahr}.json",
            "erster_tag": doc["tage"][0], "letzter_tag": doc["tage"][-1],
            "letzter_belegter_tag": max(
                (d for d, v in zip(doc["tage"], doc["netzlast"]) if v is not None),
                default=None),
            "auffaellige_tage": sorted({a["tag"] for a in doc["auffaellig"]}),
        })

    # Das Verzeichnis wird IMMER neu gebaut, auch wenn nur einzelne Jahre
    # geholt wurden -- es enthaelt den letzten belegten Tag, und der aendert
    # sich taeglich. Gebaut wird es aus den Dateien auf der Platte, nicht aus
    # dem Lauf, damit ein Teillauf die uebrigen Jahre nicht verliert.
    verzeichnis = []
    for pfad in sorted(ZIEL.glob("*.json")):
        doc = json.loads(pfad.read_text(encoding="utf-8"))
        verzeichnis.append({
            "jahr": doc["jahr"], "datei": f"data/tage/{doc['jahr']}.json",
            "erster_tag": doc["tage"][0], "letzter_tag": doc["tage"][-1],
            "letzter_belegter_tag": max(
                (d for d, v in zip(doc["tage"], doc["netzlast"]) if v is not None),
                default=None),
            "auffaellige_tage": sorted({a["tag"] for a in doc.get("auffaellig", [])}),
        })
    if True:
        (WURZEL / "data" / "tage-verzeichnis.json").write_text(
            json.dumps({
                "abgerufen": dt.datetime.now(smard.TZ).isoformat(timespec="seconds"),
                "hinweis": ("Verzeichnis der Jahresdateien. Die Seite laedt das Jahr des "
                            "gewaehlten Tages und das Vorjahr fuer den Vergleichswert."),
                "jahre": verzeichnis,
            }, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8", newline="\n")
        print("  geschrieben: data/tage-verzeichnis.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
