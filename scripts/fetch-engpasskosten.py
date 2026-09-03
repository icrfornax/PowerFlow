"""Holt die Kosten des Engpassmanagements von der ENTSO-E Transparency Platform.

Aufruf:  python scripts/fetch-engpasskosten.py --pruefen 2025
         python scripts/fetch-engpasskosten.py            (alle Jahre ab 2019)
         python scripts/fetch-engpasskosten.py 2025 2026  (nur diese Jahre)

WAS DIE QUELLE LIEFERT -- am 03.09.2026 durch Abruf belegt
----------------------------------------------------------
Datenpunkt 13.1.C der Verordnung 543/2013, "Costs of congestion management".
Im RESTful API: documentType=A92, in_Domain = out_Domain = REGELZONE.

  * Aufloesung P1M -- ein Wert je MONAT und Regelzone. Es gibt KEINE Kosten je
    Massnahme und keine Tageswerte. Wer einen Preis je Massnahme ausweist, hat
    ihn erfunden.
  * Waehrung aus den Daten: currency_Unit.name = EUR. Nicht aus der Doku
    uebernommen.
  * Zahlen mit PUNKT als Dezimaltrennzeichen ("-84430.14"), echte XML-Zahlen.
    Nachgesehen, nicht angenommen -- die Regel steht in CLAUDE.md.
  * Werte koennen NEGATIV sein (Erloese statt Kosten). Sie werden nicht auf
    null geklemmt.

DIE WICHTIGSTE FALLE: B04 IST DIE SUMME
---------------------------------------
Je Monat und Zone kommen bis zu drei Zeitreihen, unterschieden durch
businessType:

    A46  System Operator re-dispatching   -> Redispatch-Kosten
    B03  Counter trade                    -> Countertrade-Kosten
    B04  Congestion costs                 -> die GESAMTSUMME

B04 ist **kein dritter Posten**. Gemessen ueber 16 Stichmonate 2025 gilt
A46 + B03 = B04 auf den Cent; wo es abweicht, ist die Differenz der Posten
"Sonstiges" aus dem Dateischema (RedispatchingCosts, CountertradingCosts,
OtherCosts, TotalCosts). Wer die drei Reihen addiert, verdoppelt die Kosten --
beim ersten Lauf kamen so 3,64 statt 1,82 Mrd. EUR fuer 2025 heraus.

Die Codes stammen aus der Codeliste der Plattform (Artikel "BusinessType",
Stand 29.06.2023), nicht aus dem Gedaechtnis.
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import entsoe

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "engpasskosten.json"

DOKUMENT = "A92"
ERSTES_JAHR = 2019          # 2019 ist der aelteste vollstaendig gepruefte Jahrgang

# businessType -> unser Feldname. B04 steht bewusst NICHT hier: es ist die
# Summe und wird getrennt gefuehrt.
POSTEN = {"A46": "redispatch", "B03": "countertrade"}
SUMME = "B04"


def monate(jahr: int) -> list[tuple[str, str, str]]:
    """(Monatsmarke, periodStart, periodEnd) fuer jeden Monat des Jahres."""
    raus = []
    for m in range(1, 13):
        a = dt.date(jahr, m, 1)
        b = dt.date(jahr + (m == 12), m % 12 + 1, 1)
        raus.append((f"{jahr:04d}-{m:02d}",
                     a.strftime("%Y%m%d0000"), b.strftime("%Y%m%d0000")))
    return raus


def hole_monat(auftrag: tuple) -> tuple:
    """Ein Monat einer Regelzone.

    Gibt (Zone, Marke, {businessType: EUR}, unlesbare, auffaellige) zurueck.
    """
    zone, eic, marke, von, bis = auftrag
    auffaellig: list[dict] = []
    try:
        wurzel = entsoe.hole(documentType=DOKUMENT, in_Domain=eic, out_Domain=eic,
                             periodStart=von, periodEnd=bis)
    except entsoe.Nichtvorhanden:
        return zone, marke, {}, 0, auffaellig
    n = entsoe.namensraum(wurzel)
    werte: dict[str, float] = collections.defaultdict(float)
    unlesbar = 0
    for reihe in wurzel.findall("n:TimeSeries", n):
        art = (reihe.findtext("n:businessType", default="", namespaces=n) or "").strip()
        waehrung = (reihe.findtext("n:currency_Unit.name", default="",
                                   namespaces=n) or "").strip()
        # Die Waehrung wird GEPRUEFT, nicht angenommen -- und die Pruefung hat
        # beim ersten Lauf sofort etwas gefunden: fuer 50Hertz im Dezember 2021
        # steht in allen drei Reihen "BAM", die bosnische Mark. Die Betraege
        # (33,8 und 34,6 Mio.) sind als EUR plausibel, als BAM waeren sie halb
        # so gross. Es ist ein Fehler der Quelle.
        #
        # Behandelt wie der falsche Schweiz-Import vom 09.02.2015: der Monat
        # wird als FEHLEND gefuehrt, nicht umgerechnet und nicht stillschweigend
        # als EUR gelesen. Der Originalwert bleibt in "auffaellig" sichtbar.
        # Eine Umrechnung waere geraten -- wir wissen nicht, ob das Etikett
        # falsch ist oder die Zahl.
        if waehrung != "EUR":
            auffaellig.append({
                "monat": marke, "zone": zone, "waehrung": waehrung,
                "betraege": {a: round(b, 2) for a, b in (
                    (art2, sum(float(p2.findtext("n:congestionCost_Price.amount",
                                                 default="0", namespaces=n))
                               for p2 in r2.findall("n:Period/n:Point", n)))
                    for r2, art2 in ((x, (x.findtext("n:businessType", default="",
                                                     namespaces=n) or "").strip())
                                     for x in wurzel.findall("n:TimeSeries", n)))},
                "warum": ("Waehrung der Quelle ist nicht EUR. Der Monat wird als "
                          "fehlend gefuehrt, nicht umgerechnet."),
            })
            return zone, marke, {}, unlesbar, auffaellig
        for punkt in reihe.findall("n:Period/n:Point", n):
            roh = punkt.findtext("n:congestionCost_Price.amount",
                                 default="", namespaces=n)
            try:
                # Dezimaltrennzeichen der Quelle ist ein PUNKT -- nachgesehen.
                werte[art] += float(roh)
            except (TypeError, ValueError):
                unlesbar += 1
    return zone, marke, dict(werte), unlesbar, auffaellig


def sammeln(jahre: list[int]) -> dict:
    auftraege = [(zone, eic, marke, von, bis)
                 for jahr in jahre
                 for marke, von, bis in monate(jahr)
                 for zone, eic in entsoe.REGELZONEN.items()]
    heute = dt.date.today()
    auftraege = [a for a in auftraege if a[2] <= f"{heute.year:04d}-{heute.month:02d}"]

    je_monat: dict[str, dict] = {}
    unbekannt: collections.Counter = collections.Counter()
    unlesbar_gesamt = 0
    fehlend: list[str] = []
    auffaellig: list[dict] = []
    # Acht Straenge: die Plattform erlaubt 400 Abrufe je Minute, das bleibt
    # deutlich darunter und ist trotzdem in Minuten statt Stunden fertig.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for zone, marke, werte, unlesbar, komisch in pool.map(hole_monat, auftraege):
            unlesbar_gesamt += unlesbar
            auffaellig.extend(komisch)
            if not werte:
                fehlend.append(f"{marke}/{zone}")
                continue
            for art in werte:
                if art not in POSTEN and art != SUMME:
                    unbekannt[art] += 1
            e = je_monat.setdefault(marke, {
                "gesamt": 0.0, "redispatch": 0.0, "countertrade": 0.0,
                "je_zone": {z: 0.0 for z in entsoe.REGELZONEN},
            })
            e["gesamt"] += werte.get(SUMME, 0.0)
            e["je_zone"][zone] += werte.get(SUMME, 0.0)
            for art, feld in POSTEN.items():
                e[feld] += werte.get(art, 0.0)

    if unbekannt:
        raise SystemExit(
            f"ABBRUCH: unbekannte businessType {dict(unbekannt)}. Die Codeliste "
            "der Plattform nachsehen und POSTEN erweitern -- nicht ignorieren, "
            "sonst fehlt ein Kostenposten in der Summe.")
    if unlesbar_gesamt:
        raise SystemExit(
            f"ABBRUCH: {unlesbar_gesamt} Betraege waren nicht als Zahl lesbar. "
            "Hat die Quelle ihr Zahlenformat geaendert? Nachsehen, nicht "
            "wegwerfen.")

    marken = sorted(je_monat)
    doc = {
        "_quelle": ("ENTSO-E Transparency Platform -- "
                    "https://transparency.entsoe.eu/, Datenpunkt 13.1.C "
                    "'Costs of congestion management', documentType A92"),
        "_lizenz": ("CC BY 4.0. Datenpunkt 19/21 der 'List of Data available "
                    "for free re-use', Fassung 18.10.2023 -- siehe "
                    "docs/beleg-redispatch.md und docs/beleg-engpasskosten.md."),
        "_namensnennung": "ENTSO-E Transparency Platform",
        "_hinweis": (
            "Kosten des Engpassmanagements, je MONAT und Regelzone, in EUR. "
            "Eine feinere Aufloesung gibt es nicht: die Quelle liefert P1M. Es "
            "gibt keine Kosten je Massnahme und keine Tageswerte. "
            "WICHTIG: 'gesamt' ist der businessType B04 der Quelle und damit "
            "IHRE Summe -- nicht unsere. 'redispatch' (A46) und 'countertrade' "
            "(B03) sind Posten darin; 'sonstiges' ist der ausgerechnete Rest "
            "zwischen ihrer Summe und 'gesamt' und entspricht der Position "
            "OtherCosts des Dateischemas. Es gilt redispatch + countertrade + "
            "sonstiges = gesamt. Wer 'gesamt' zu den Posten ADDIERT, "
            "verdoppelt. Negative Werte kommen vor (Erloese statt Kosten) und "
            "werden nicht auf null geklemmt."),
        "einheit": "EUR",
        "aufloesung": "P1M",
        "zonen": list(entsoe.REGELZONEN),
        "monate": marken,
        "gesamt": [round(je_monat[m]["gesamt"], 2) for m in marken],
        "redispatch": [round(je_monat[m]["redispatch"], 2) for m in marken],
        "countertrade": [round(je_monat[m]["countertrade"], 2) for m in marken],
        # Der dritte Posten des Dateischemas ("OtherCosts"). Die Plattform
        # liefert ihn nicht als eigene Reihe, sondern nur als Rest zwischen der
        # Gesamtsumme B04 und den beiden genannten Posten. Meist ist er null --
        # im Juni 2026 sind es 31,4 von 122,6 Mio. EUR. Er wird ausgerechnet und
        # AUSGEWIESEN, nicht in eine der beiden anderen Zahlen geschoben.
        "sonstiges": [round(je_monat[m]["gesamt"] - je_monat[m]["redispatch"]
                            - je_monat[m]["countertrade"], 2) for m in marken],
        "je_zone": {z: [round(je_monat[m]["je_zone"][z], 2) for m in marken]
                    for z in entsoe.REGELZONEN},
        # Monate, in denen mindestens eine Zone nichts gemeldet hat. Sie stehen
        # in der Datei, damit eine Teilmeldung nicht wie eine kleine Rechnung
        # aussieht.
        "unvollstaendige_monate": sorted({f.split("/")[0] for f in fehlend}),
        "fehlende_meldungen": sorted(fehlend),
        "unlesbare_betraege": unlesbar_gesamt,
        # Werte, die die Quelle selbst falsch etikettiert. Sie werden als
        # fehlend gefuehrt und NICHT umgerechnet -- der Originalwert bleibt hier
        # sichtbar. Dasselbe Vorgehen wie beim falschen Schweiz-Import vom
        # 09.02.2015 in den Tagesreihen.
        "auffaellig": sorted(auffaellig, key=lambda x: (x["monat"], x["zone"])),
        # Monate, in denen "Sonstiges" mehr als 5 % der Summe ausmacht. Sie
        # stehen hier, damit niemand sie fuer einen Rundungsrest haelt.
        "monate_mit_sonstigem": [
            m for m in marken
            if je_monat[m]["gesamt"] and abs(
                je_monat[m]["gesamt"] - je_monat[m]["redispatch"]
                - je_monat[m]["countertrade"]) > abs(je_monat[m]["gesamt"]) * 0.05],
    }
    return doc


def zeigen(doc: dict) -> None:
    print(f"  {len(doc['monate'])} Monate, {doc['monate'][0]} bis {doc['monate'][-1]}")
    jahre: dict[str, list] = {}
    for i, m in enumerate(doc["monate"]):
        jahre.setdefault(m[:4], []).append(i)
    print(f"  {'Jahr':6s} {'gesamt':>12s} {'Redispatch':>12s} {'Countertrade':>13s} "
          f"{'Sonstiges':>11s}")
    for jahr, stellen in jahre.items():
        g = sum(doc["gesamt"][i] for i in stellen)
        r = sum(doc["redispatch"][i] for i in stellen)
        c = sum(doc["countertrade"][i] for i in stellen)
        print(f"  {jahr:6s} {g/1e6:11,.1f}M {r/1e6:11,.1f}M {c/1e6:12,.1f}M "
              f"{(g-r-c)/1e6:10,.1f}M")
    if doc["unvollstaendige_monate"]:
        print(f"  unvollstaendig gemeldet: {doc['unvollstaendige_monate']}")
    for a in doc["auffaellig"]:
        print(f"  AUFFAELLIG {a['monat']} {a['zone']}: Waehrung {a['waehrung']}, "
              f"{a['betraege']} -- als fehlend gefuehrt")


def main(argv: list[str]) -> int:
    nur_lesen = "--pruefen" in argv
    jahre = [int(a) for a in argv if a.isdigit()]
    if not jahre:
        jahre = list(range(ERSTES_JAHR, dt.date.today().year + 1))
    print(f"ENTSO-E 13.1.C, Jahre {jahre[0]} bis {jahre[-1]} ...")
    doc = sammeln(jahre)
    zeigen(doc)
    if nur_lesen:
        print("\nNur gelesen. Es wurde nichts nach data/ geschrieben.")
        return 0
    ZIEL.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    print(f"  geschrieben: data/engpasskosten.json ({ZIEL.stat().st_size:,} Bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
