"""Holt die Lastprognose und die gemessene Last von ENTSO-E und vergleicht sie.

Aufruf:  python scripts/fetch-lastprognose.py --pruefen 2025
         python scripts/fetch-lastprognose.py                (alle Jahre)
         python scripts/fetch-lastprognose.py 2025 2026      (nur diese)

WOZU
----
Die uebrige Seite zeigt, was war. Das hier zeigt, was ANGEKUENDIGT war -- und
wie weit die Ankuendigung danebenlag. Beide Reihen kommen aus derselben Quelle
und in derselben Aufloesung; der Vergleich ist damit kein Aepfel-und-Birnen.

    6.1.B  Day-ahead total load forecast   documentType A65, processType A01
    6.1.A  Actual total load               documentType A65, processType A16

BELEGT AM 05.09.2026 DURCH ABRUF
--------------------------------
* Beide in PT15M, Einheit **MAW** -- Megawatt, also LEISTUNG. Energie je
  Viertelstunde ist Leistung mal 0,25 h. Wer MAW als MWh liest, ist um den
  Faktor vier daneben.
* Die Reihe beginnt 2019. Fuer 2015 und 2017 antwortet die Plattform mit
  "No matching data found".
* Die Vorschau reicht genau EINEN Tag: fuer morgen kommen Werte, fuer
  uebermorgen nicht. Sie waechst im Lauf des Tages -- am 05.09. um 21 Uhr
  standen fuer den 06.09. erst 88 der 96 Viertelstunden.
* Eine Abfrage darf hoechstens rund einen Monat umfassen; 92 Tage werden mit
  HTTP 400 abgewiesen.
* 6.1.B ist Datenpunkt 1 der Freigabeliste (Artikel 6.1.b) und damit CC BY 4.0.
  6.1.A -- die gemessene Last -- steht NICHT auf der Liste; sie wird hier nur
  als Vergleichsgroesse im selben Abruf gebraucht und nicht veroeffentlicht.
  Was in die Datei geht, ist die ABWEICHUNG, plus die Prognose selbst.

WAS GERECHNET WIRD
------------------
Je Kalendertag (Ortszeit):

    prognose_mwh   Summe der Prognose ueber den Tag
    ist_mwh        Summe der Messung ueber den Tag
    mape_prozent   mittlerer ABSOLUTER Fehler je Viertelstunde, in Prozent der
                   Messung -- die eigentliche Guetezahl. Aus den Tagessummen
                   allein ist sie NICHT zu bilden: zu hohe und zu niedrige
                   Viertelstunden heben sich darin auf.
    punkte         wie viele Viertelstunden in beide Reihen fielen
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import entsoe

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "lastprognose"
VERZEICHNIS = WURZEL / "data" / "lastprognose-verzeichnis.json"

DE_LU = "10Y1001A1001A82H"
ERSTES_JAHR = 2019
SCHRITT_MIN = {"PT15M": 15, "PT30M": 30, "PT60M": 60}


def reihe(processType: str, von: str, bis: str) -> dict:
    """{UTC-Zeitpunkt: MW}. Leer, wenn die Plattform nichts hat."""
    try:
        w = entsoe.hole(documentType="A65", processType=processType,
                        outBiddingZone_Domain=DE_LU, periodStart=von, periodEnd=bis)
    except entsoe.Nichtvorhanden:
        return {}
    n = entsoe.namensraum(w)
    raus: dict[dt.datetime, float] = {}
    for s in w.findall("n:TimeSeries", n):
        einheit = (s.findtext("n:quantity_Measure_Unit.name", default="",
                              namespaces=n) or "").strip()
        # Die Einheit wird GEPRUEFT. MAW ist Leistung; kaeme eines Tages MAWH,
        # waere jede Rechnung unten um den Faktor vier falsch.
        if einheit != "MAW":
            raise SystemExit(f"ABBRUCH: Einheit {einheit!r} statt MAW bei "
                             f"processType {processType}, {von}.")
        kurve = (s.findtext("n:curveType", default="", namespaces=n) or "").strip()
        per = s.find("n:Period", n)
        schritt = SCHRITT_MIN[per.findtext("n:resolution", namespaces=n)]
        start = dt.datetime.strptime(per.findtext("n:timeInterval/n:start", namespaces=n),
                                     "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        ende = dt.datetime.strptime(per.findtext("n:timeInterval/n:end", namespaces=n),
                                    "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        mtus = int((ende - start).total_seconds() / 60 / schritt)
        punkte = sorted((int(p.findtext("n:position", namespaces=n)),
                         float(p.findtext("n:quantity", namespaces=n)))
                        for p in per.findall("n:Point", n))
        for i, (pos, wert) in enumerate(punkte):
            # curveType A03 heisst: der Wert gilt bis zum naechsten genannten
            # Punkt. Bei A01 ist jede Stelle besetzt, dann ist die Schleife
            # genau ein Durchlauf.
            letzte = (punkte[i + 1][0] if i + 1 < len(punkte) else mtus + 1) \
                if kurve == "A03" else pos + 1
            for k in range(pos, letzte):
                raus[start + dt.timedelta(minutes=schritt * (k - 1))] = wert
    return raus


def monat_holen(auftrag: tuple) -> tuple:
    jahr, monat = auftrag
    a = dt.datetime(jahr, monat, 1, tzinfo=entsoe_tz())
    b = (dt.datetime(jahr + (monat == 12), monat % 12 + 1, 1, tzinfo=entsoe_tz()))
    von, bis = a.strftime("%Y%m%d%H%M"), b.strftime("%Y%m%d%H%M")
    return (jahr, monat, reihe("A01", von, bis), reihe("A16", von, bis))


def entsoe_tz():
    # Die Plattform erwartet die Zeitangaben in UTC.
    return dt.timezone.utc


def jahr_bauen(jahr: int) -> dict:
    heute = dt.date.today()
    monate = [(jahr, m) for m in range(1, 13)
              if dt.date(jahr, m, 1) <= heute]
    tage: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for _, _, prog, ist in pool.map(monat_holen, monate):
            for t in sorted(set(prog) | set(ist)):
                # Der Monatsblock beginnt in UTC und reicht in Ortszeit ueber
                # die Jahresgrenze. Ohne diesen Filter stuende der 01.01. des
                # Folgejahres in der Datei des Vorjahres.
                lokal = t.astimezone(TZ)
                if lokal.year != jahr:
                    continue
                tag = lokal.date().isoformat()
                e = tage.setdefault(tag, {"p": 0.0, "i": 0.0, "fehler": 0.0,
                                          "n": 0, "np": 0, "ni": 0})
                if t in prog:
                    e["p"] += prog[t] * 0.25
                    e["np"] += 1
                if t in ist:
                    e["i"] += ist[t] * 0.25
                    e["ni"] += 1
                if t in prog and t in ist and ist[t]:
                    e["fehler"] += abs(prog[t] - ist[t]) / ist[t] * 100
                    e["n"] += 1

    schluessel = sorted(tage)
    return {
        "_quelle": ("ENTSO-E Transparency Platform -- Datenpunkt 6.1.B "
                    "'Day-ahead total load forecast' gegen 6.1.A 'Actual total "
                    "load', documentType A65, processType A01 und A16"),
        "_lizenz": ("CC BY 4.0 fuer die Prognose (6.1.b, Datenpunkt 1 der List "
                    "of Data available for free re-use). Die gemessene Last "
                    "steht NICHT auf dieser Liste und wird hier nicht "
                    "veroeffentlicht -- sie geht nur als Vergleichsgroesse in "
                    "die Abweichung ein. Die Last selbst zeigt diese Seite aus "
                    "SMARD, wo sie unter CC BY 4.0 steht."),
        "_namensnennung": "ENTSO-E Transparency Platform",
        "_hinweis": (
            "Je Kalendertag in Ortszeit. prognose_mwh ist die Summe der "
            "Day-ahead-Prognose, mape_prozent der mittlere ABSOLUTE Fehler je "
            "Viertelstunde in Prozent der Messung. Die Einheit der Quelle ist "
            "MAW, also Leistung; Energie je Viertelstunde ist Leistung mal "
            "0,25 h. Der mittlere absolute Fehler ist aus Tagessummen NICHT "
            "zu bilden -- zu hohe und zu niedrige Viertelstunden heben sich "
            "darin auf. Deshalb steht er hier und wird nicht in der Anzeige "
            "gerechnet. Die Reihe beginnt 2019."),
        "jahr": jahr,
        "tage": schluessel,
        "prognose_mwh": [round(tage[k]["p"], 1) for k in schluessel],
        "mape_prozent": [round(tage[k]["fehler"] / tage[k]["n"], 2)
                         if tage[k]["n"] else None for k in schluessel],
        "abweichung_mwh": [round(tage[k]["p"] - tage[k]["i"], 1)
                           if tage[k]["ni"] else None for k in schluessel],
        "punkte": [tage[k]["n"] for k in schluessel],
    }


TZ = None       # wird in main gesetzt, damit smard.TZ nicht doppelt geladen wird


# data/vorschau.json WIRD HIER NICHT MEHR GESCHRIEBEN.
# Bis zum 05.09.2026 baute dieses Skript aus 6.1.B zusaetzlich eine Vorschau
# nach data/vorschau.json -- dieselbe Datei, die fetch-vorschau.py schreibt.
# Zwei Schreiber auf einer Datei sind ein stiller Ueberschreiber: wer zuletzt
# lief, gewann, und im Workflow war das die Reihenfolge der Schritte. Die
# Vorschau enthaelt heute Erzeugung je Traeger und den Boersenpreis, also
# mehr als die Last allein; sie kommt aus SMARD. Dieses Skript liefert nur
# noch die PROGNOSEGUETE der Vergangenheit -- das ist eine andere Frage.

def main(argv: list[str]) -> int:
    global TZ
    import smard
    TZ = smard.TZ
    nur_lesen = "--pruefen" in argv
    jahre = [int(a) for a in argv if a.isdigit()]
    if not jahre:
        jahre = list(range(ERSTES_JAHR, dt.date.today().year + 1))
    ZIEL.mkdir(parents=True, exist_ok=True)
    verzeichnis = []
    for jahr in jahre:
        doc = jahr_bauen(jahr)
        mit = [x for x in doc["mape_prozent"] if x is not None]
        print(f"  {jahr}: {len(doc['tage'])} Tage, {len(mit)} mit Vergleich, "
              f"mittlerer Fehler {sum(mit)/len(mit):.2f} %" if mit
              else f"  {jahr}: keine Daten")
        if nur_lesen or not doc["tage"]:
            continue
        pfad = ZIEL / f"{jahr}.json"
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        verzeichnis.append({"jahr": jahr, "datei": f"data/lastprognose/{jahr}.json",
                            "tage": len(doc["tage"])})
        print(f"      geschrieben: {pfad.name} ({pfad.stat().st_size:,} Bytes)")
    if nur_lesen:
        print("\nNur gelesen. Es wurde nichts nach data/ geschrieben.")
        return 0
    VERZEICHNIS.write_text(json.dumps({
        "_quelle": "ENTSO-E Transparency Platform",
        "_hinweis": "Welche Jahresdatei welchen Zeitraum abdeckt.",
        "jahre": verzeichnis,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"  geschrieben: {VERZEICHNIS.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
