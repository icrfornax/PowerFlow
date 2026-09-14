"""Holt Viertelstundenwerte als TAGESDATEIEN nach data/viertelstunden/.

Aufruf:  python scripts/fetch-viertelstunden.py --wochen 2   (taeglicher Lauf)
         python scripts/fetch-viertelstunden.py 2025 2026     (ganze Jahre)
         python scripts/fetch-viertelstunden.py --ab 2026-01-01
         python scripts/fetch-viertelstunden.py --nur-verzeichnis

Warum ueberhaupt Viertelstunden
-------------------------------
Weil der Markt sie hat. Seit dem 01.10.2025 wird die Day-ahead-Auktion fuer
DE-LU viertelstuendlich geraeumt; eine Stundenkurve mittelt genau die
Preisspitzen weg, um die es dabei geht. Dasselbe gilt fuer die Rampen von
Photovoltaik und Wind: der steilste Abschnitt eines Sonnenuntergangs ist in
Stundenwerten eine Gerade.

Warum TAGESDATEIEN und nicht Monatsdateien
------------------------------------------
Die Seite zeigt Viertelstunden nur fuer hoechstens zwei Tage (192 Punkte --
dieselbe Lesbarkeitsgrenze, an der die Stundenkurve bei sieben Tagen endet).
Wer zwei Tage ansieht, soll auch nur zwei Tage laden. Eine Monatsdatei waere
rund 400 kB fuer einen Tag Anzeige; eine Tagesdatei ist rund 13 kB.

Das ist die Antwort auf den offenen Punkt, der jahrelang auf der Seite stand:
"48 statt 12 MB, die jeder Besucher mitlaedt". Die Zahl war falsch -- niemand
laedt den ganzen Bestand, weder bei den Stunden- noch bei den Tagesdateien.
Gemessen wird, was EIN Seitenaufruf holt, und das sind hier zwei Dateien.

Einheit -- AUS DEN DATEN BEWIESEN, nicht aus der Doku
-----------------------------------------------------
Die Werte sind MWh JE VIERTELSTUNDE, also Arbeit, nicht Leistung. Beweis: die
Summe der vier Viertelstunden einer Stunde trifft den Stundenwert derselben
Quelle. Gemessen ueber 48 Stunden je Reihe, groesste Abweichung 0,02 MWh --
Rundung. Das Skript rechnet diese Probe bei jedem Lauf nach und BRICHT AB, wenn
sie nicht aufgeht; als Leistung gelesen laege alles um den Faktor vier daneben,
und genau dieser Fehler ist bei der Vorschau schon einmal passiert.

DER PREIS IST VOR DEM 01.10.2025 KEIN VIERTELSTUNDENWERT
---------------------------------------------------------
SMARD liefert die Preisreihe zwar durchgehend viertelstuendlich, aber davor ist
es der VIERMAL WIEDERHOLTE Stundenpreis. Gemessen: bis zum 30.09.2025 sind
100 % aller Vierergruppen in sich identisch, ab dem 01.10.2025 keine einzige.
Die Umstellungswoche zeigt genau den Bruch. Das bestaetigt aus einer zweiten,
unabhaengigen Richtung, was in docs/beleg-entsoe-datenpunkte.md ueber die
ENTSO-E-Reihe steht: Sequence 1 wechselte am 01.10.2025 von PT60M auf PT15M.

Deshalb steht in JEDER Tagesdatei das Feld `preis_viertelstuendlich`. Es wird
GEMESSEN, nicht aus dem Datum abgeleitet -- eine Schwelle, die man hinschreibt,
veraltet still. Die Seite beschriftet den Preis danach.

Zeit
----
Die Marken sind LOKAL (Europe/Berlin) und heissen "JJJJ-MM-TTTHH:MM".
Geschluesselt wird ueber den ZEITSTEMPEL, nie ueber die Marke: am Tag der
Rueckstellung gibt es 02:00 bis 02:45 zweimal. Ein Tag hat deshalb 92, 96 oder
100 Marken, und genau so soll es sein.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "viertelstunden"
VERZEICHNIS = WURZEL / "data" / "viertelstunden-verzeichnis.json"

# Grosshandelspreis Deutschland/Luxemburg, Day-Ahead, in Euro je MWh.
PREIS_FILTER = 4169

# Plausibilitaetsgrenze fuer einen einzelnen Aussenhandelswert je Land und
# Richtung, in MWh je Viertelstunde. Die Stundengrenze in fetch-verlauf.py ist
# 15.000 MWh/h; ein Viertel davon waere 3.750. Hier steht bewusst dieselbe
# Groessenordnung wie dort -- knapp das Dreifache des groessten je beobachteten
# Wertes -- und nicht der Viertelwert, damit eine echte Spitze nicht am Rand
# der Grenze steht. Gefangen werden soll der bekannte Fehlwert der Quelle
# (Schweiz-Import 09.02.2015, 25.009.206 MWh), nicht die Wirklichkeit.
GRENZE_VIERTEL_MWH = 5_000.0

# Wie viele unlesbare oder unplausible Werte der Lauf hinnimmt, bevor er
# abbricht. Ein Zaehler, den niemand prueft, ist kein Zaehler -- dieser wird in
# die Datei geschrieben UND von validate.py noch einmal nachgerechnet.
BUDGET_AUFFAELLIG = 20


def marke(ms: int) -> str:
    """Lokale Viertelstundenmarke JJJJ-MM-TTTHH:MM.

    ACHTUNG: am Tag der Rueckstellung NICHT eindeutig. Taugt als Beschriftung,
    niemals als Schluessel. Derselbe Fehler hat in den Stundenwerten schon
    einmal elf Oktobertage je eine Stunde gekostet.
    """
    d = dt.datetime.fromtimestamp(ms / 1000, smard.TZ)
    return f"{d:%Y-%m-%dT%H:%M}"


def tag_von(ms: int) -> str:
    return f"{dt.datetime.fromtimestamp(ms / 1000, smard.TZ):%Y-%m-%d}"


def hole(filter_id: int, bloecke: list[int], aufloesung: str) -> dict[int, float]:
    """Alle Werte einer Reihe, geschluesselt ueber den Zeitstempel.

    Nichtvorhanden (HTTP 404) heisst: die Reihe gibt es in diesem Zeitraum
    nicht. Das ist eine ANTWORT und kein Ausfall -- Kernenergie etwa endet am
    15.04.2023. Sie wird uebergangen, aber nicht stillschweigend: was leer
    bleibt, faellt beim Schreiben als fehlende Reihe auf.
    """
    werte: dict[int, float] = {}
    for block in bloecke:
        try:
            paare = smard.reihe(filter_id, smard.REGION_DE, aufloesung, block)
        except smard.Nichtvorhanden:
            continue
        for t, v in paare:
            if v is not None:
                werte[t] = v
    return werte


def probe_einheit(viertel: dict[int, float], stunde: dict[int, float],
                  name: str) -> tuple[int, float]:
    """Die Summe der vier Viertelstunden muss den Stundenwert treffen.

    Das ist der BEWEIS der Einheit aus den Daten. Wer die Werte fuer Leistung
    haelt, liegt um den Faktor vier daneben -- bei der Vorschau auf morgen ist
    genau das passiert ("272 GWh, Spitze 16 GW").
    """
    geprueft, groesste = 0, 0.0
    for ts, hv in stunde.items():
        vier = [viertel.get(ts + i * 900_000) for i in range(4)]
        if any(v is None for v in vier):
            continue
        geprueft += 1
        groesste = max(groesste, abs(sum(vier) - hv))
    if geprueft and groesste > 1.0:
        raise SystemExit(
            f"ABBRUCH: bei {name} trifft die Summe der vier Viertelstunden den "
            f"Stundenwert nicht (groesste Abweichung {groesste:.3f} MWh ueber "
            f"{geprueft} Stunden). Entweder hat die Quelle die Einheit "
            "geaendert, oder es sind Leistungen statt Arbeit. Nicht "
            "weiterrechnen.")
    return geprueft, groesste


def preis_ist_viertelstuendlich(werte: list[float | None]) -> bool | None:
    """Sind das echte Viertelstundenpreise -- oder vervierfachte Stundenpreise?

    GEMESSEN, nicht aus dem Datum abgeleitet. Bis zum 30.09.2025 sind alle
    Vierergruppen in sich identisch, ab dem 01.10.2025 keine einzige. Eine
    Schwelle, die man hinschreibt, veraltet still; diese rechnet sich aus.

    None heisst: zu wenige Werte fuer eine Aussage.
    """
    gruppen, gleich = 0, 0
    for i in range(0, len(werte) - 3, 4):
        vier = werte[i:i + 4]
        if any(v is None for v in vier):
            continue
        gruppen += 1
        if len(set(vier)) == 1:
            gleich += 1
    if gruppen < 8:
        return None
    # Ein einzelner flacher Preisverlauf kann zufaellig vier gleiche Werte
    # haben. Deshalb eine Mehrheit und keine Gleichheit: ueber einen ganzen Tag
    # sind es entweder alle oder fast keine -- gemessen 100 % gegen 0 %.
    return gleich < gruppen * 0.5


def aussenhandel(bloecke: list[int]) -> tuple[dict, dict, list]:
    """Ein- und Ausfuhr je Viertelstunde, ueber alle Nachbarlaender summiert.

    Wie bei den Stundenwerten summiert und nicht je Land: 22 Reihen statt zwei
    machten die Tagesdatei zweieinhalbmal so gross. Die Aufteilung je Land
    steht in den Tageswerten.
    """
    auftraege = [(land, richtung, ids[richtung])
                 for land, ids in smard.AUSSENHANDEL.items()
                 for richtung in ("import", "export")]
    with ThreadPoolExecutor(max_workers=8) as pool:
        ergebnisse = list(pool.map(
            lambda a: hole(a[2], bloecke, smard.VIERTELSTUNDE), auftraege))

    summe: dict[str, dict[int, float]] = {"import_mwh": {}, "export_mwh": {}}
    auffaellig: list[dict] = []
    for (land, richtung, _), werte in zip(auftraege, ergebnisse):
        ziel = summe["import_mwh" if richtung == "import" else "export_mwh"]
        for ts, v in werte.items():
            # Unplausibles wird als FEHLEND gefuehrt, nicht korrigiert und nicht
            # geschaetzt. Der Originalwert bleibt sichtbar.
            if not (0 <= v <= GRENZE_VIERTEL_MWH):
                auffaellig.append({"marke": marke(ts), "land": land,
                                   "richtung": richtung, "originalwert": v,
                                   "grenze": [0, GRENZE_VIERTEL_MWH]})
                continue
            ziel[ts] = ziel.get(ts, 0.0) + v
    return summe["import_mwh"], summe["export_mwh"], auffaellig


KOPF = {
    "_quelle": "Bundesnetzagentur | SMARD.de, chart_data, Aufloesung quarterhour",
    "_lizenz": "CC BY 4.0",
    "_namensnennung": "Bundesnetzagentur | SMARD.de",
    "_hinweis": (
        "Werte sind MWh JE VIERTELSTUNDE (Arbeit), nicht MW. Bewiesen aus den "
        "Daten: die Summe der vier Viertelstunden trifft den Stundenwert "
        "derselben Quelle. Marken sind lokale Zeit (Europe/Berlin); ein Tag "
        "hat 92, 96 oder 100 Marken, an den Umstellungstagen entsprechend "
        "weniger oder mehr."),
    "_preis_hinweis": (
        "preis_eur_mwh ist der Day-ahead-Grosshandelspreis in Euro je MWh. "
        "VOR dem 01.10.2025 ist er ein STUNDENWERT, den die Quelle viermal "
        "wiederholt -- die Auktion wurde erst zu diesem Termin auf "
        "Viertelstunden umgestellt. Das Feld preis_viertelstuendlich sagt je "
        "Tag, was vorliegt, und ist gemessen, nicht aus dem Datum abgeleitet."),
    "_aussenhandel_hinweis": (
        "import_mwh und export_mwh sind ueber alle elf Nachbarlaender "
        "summiert. Die Aufteilung je Land steht in den Tageswerten unter "
        "data/tage/."),
}


def schreibe_tag(tag: str, punkte: list[int], daten: dict,
                 auffaellig: list[dict]) -> dict:
    doc = dict(KOPF)
    doc["tag"] = tag
    doc["abgerufen"] = dt.datetime.now(smard.TZ).strftime("%Y-%m-%d")
    doc["marken"] = [marke(ts) for ts in punkte]
    doc["netzlast"] = [daten["netzlast"].get(ts) for ts in punkte]
    doc["erzeugung"] = {}
    for _, name in sorted(smard.ERZEUGUNG.items(), key=lambda x: x[1]):
        reihe = [daten[name].get(ts) for ts in punkte]
        # Eine Reihe, die es in diesem Zeitraum nicht gibt (Kernenergie nach
        # dem 15.04.2023), wird WEGGELASSEN und nicht mit Nullen gefuellt. Eine
        # fehlende Reihe ist keine Erzeugung von null.
        if any(v is not None for v in reihe):
            doc["erzeugung"][name] = reihe
    doc["preis_eur_mwh"] = [daten["preis_eur_mwh"].get(ts) for ts in punkte]
    doc["preis_viertelstuendlich"] = preis_ist_viertelstuendlich(
        doc["preis_eur_mwh"])
    doc["import_mwh"] = [daten["import_mwh"].get(ts) for ts in punkte]
    doc["export_mwh"] = [daten["export_mwh"].get(ts) for ts in punkte]
    doc["auffaellig"] = [a for a in auffaellig if a["marke"][:10] == tag]

    # Jede Reihe so lang wie die Achse -- sonst ist die Datei in sich
    # widerspruechlich, und das faellt sonst erst dem Tuersteher auf.
    n = len(doc["marken"])
    schief = [k for k in ("netzlast", "preis_eur_mwh", "import_mwh", "export_mwh")
              if len(doc[k]) != n]
    schief += [f"erzeugung/{k}" for k, r in doc["erzeugung"].items() if len(r) != n]
    if schief:
        raise SystemExit(f"ABBRUCH: {tag}: Reihen passen nicht zur Achse "
                         f"({n} Marken): {schief}")

    ZIEL.mkdir(parents=True, exist_ok=True)
    (ZIEL / f"{tag}.json").write_text(
        json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8", newline="\n")
    return doc


def hole_bloecke(bloecke: list[int]) -> list[str]:
    """Holt die Bloecke und schreibt je beruehrtem Tag eine Datei."""
    reihen = [("netzlast", smard.LAST_NETZLAST),
              ("preis_eur_mwh", PREIS_FILTER)]
    reihen += [(name, fid) for fid, name in smard.ERZEUGUNG.items()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        ergebnisse = list(pool.map(
            lambda r: hole(r[1], bloecke, smard.VIERTELSTUNDE), reihen))
    daten = dict(zip((r[0] for r in reihen), ergebnisse))

    # DIE EINHEITENPROBE. Sie braucht die Stundenreihe derselben Quelle und
    # kostet zwei zusaetzliche Abrufe je Block -- das ist sie wert.
    for name, fid in (("netzlast", smard.LAST_NETZLAST),):
        std = hole(fid, bloecke, smard.STUNDE)
        geprueft, groesste = probe_einheit(daten[name], std, name)
        print(f"  Einheitenprobe {name}: {geprueft} Stunden, groesste "
              f"Abweichung {groesste:.4f} MWh")

    daten["import_mwh"], daten["export_mwh"], auffaellig = aussenhandel(bloecke)
    if len(auffaellig) > BUDGET_AUFFAELLIG:
        raise SystemExit(
            f"ABBRUCH: {len(auffaellig)} unplausible Aussenhandelswerte "
            f"(Budget {BUDGET_AUFFAELLIG}). Nachsehen, nicht wegwerfen.")

    tage: dict[str, list[int]] = {}
    for ts in sorted(daten["netzlast"]):
        tage.setdefault(tag_von(ts), []).append(ts)

    geschrieben = []
    for tag, punkte in sorted(tage.items()):
        doc = schreibe_tag(tag, punkte, daten, auffaellig)
        geschrieben.append(tag)
        # DREI Zustaende, nicht zwei. None heisst "keine Preise", nicht
        # "stuendlich" -- der letzte Tag hat oft noch keinen Preis, und ein
        # falsches Wort im Protokoll schickt einen auf die Suche nach einem
        # Fehler, den es nicht gibt. Genau das ist beim ersten Lauf passiert.
        preiswort = {True: "viertelstuendlich", False: "stuendlich (wiederholt)",
                     None: "keine Preise"}[doc["preis_viertelstuendlich"]]
        print(f"  {tag}: {len(doc['marken'])} Marken, "
              f"{len(doc['erzeugung'])} Erzeugungsreihen, Preis {preiswort}")
    return geschrieben


def verzeichnis_bauen() -> dict:
    """AUS DEM ORDNER, nie aus dem Lauf.

    Am 06.09.2026 hat ein aus dem LAUF gebautes Verzeichnis ein Verzeichnis von
    zehn auf zwei Jahre gekuerzt, obwohl alle zehn Dateien weiter dalagen. Die
    Bedingung lautet: Verzeichnis gleich Ordner, und validate.py prueft sie.
    """
    tage = []
    for pfad in sorted(ZIEL.glob("*.json")):
        d = json.loads(pfad.read_text(encoding="utf-8"))
        tage.append({
            "tag": d["tag"],
            "marken": len(d["marken"]),
            "erzeugungsreihen": len(d["erzeugung"]),
            "preis_viertelstuendlich": d.get("preis_viertelstuendlich"),
            "auffaellig": len(d.get("auffaellig") or []),
        })
    doc = {
        "_quelle": KOPF["_quelle"],
        "_lizenz": KOPF["_lizenz"],
        "_namensnennung": KOPF["_namensnennung"],
        "_hinweis": (
            "Welcher Tag viertelstuendlich vorliegt und mit wie vielen Marken. "
            "Aus dem ORDNER gebaut, nicht aus dem letzten Lauf. Die Seite "
            "liest daraus, ab wann sie Viertelstunden anbieten darf."),
        "tage": tage,
        "von": tage[0]["tag"] if tage else None,
        "bis": tage[-1]["tag"] if tage else None,
    }
    VERZEICHNIS.write_text(
        json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8", newline="\n")
    return doc


def main(argv: list[str]) -> None:
    if "--nur-verzeichnis" in argv:
        d = verzeichnis_bauen()
        print(f"Verzeichnis: {len(d['tage'])} Tage, {d['von']} bis {d['bis']}")
        return

    alle = smard.wochenbloecke(smard.LAST_NETZLAST, smard.REGION_DE,
                               smard.VIERTELSTUNDE)
    bloecke = alle
    if "--wochen" in argv:
        n = int(argv[argv.index("--wochen") + 1])
        bloecke = alle[-n:]
    elif "--ab" in argv:
        ab = argv[argv.index("--ab") + 1]
        grenze = dt.datetime.fromisoformat(ab).replace(tzinfo=smard.TZ).timestamp() * 1000
        # Der Block, in dem "ab" liegt, gehoert dazu -- er beginnt davor.
        vorher = [b for b in alle if b <= grenze]
        bloecke = alle[alle.index(vorher[-1]):] if vorher else alle
    else:
        jahre = [int(a) for a in argv[1:] if a.isdigit()]
        if jahre:
            bloecke = [b for b in alle
                       if int(tag_von(b)[:4]) in jahre
                       or int(tag_von(b + 6 * 86_400_000)[:4]) in jahre]

    print(f"{len(bloecke)} Wochenbloecke, {len(bloecke) * 35} Abrufe erwartet")
    # In Haeppchen, damit ein Abbruch nicht alles wegwirft und der Fortschritt
    # sichtbar bleibt.
    geschrieben = []
    for i in range(0, len(bloecke), 4):
        teil = bloecke[i:i + 4]
        print(f"Block {i + 1}-{i + len(teil)} von {len(bloecke)}")
        geschrieben += hole_bloecke(teil)

    d = verzeichnis_bauen()
    print(f"\n{len(geschrieben)} Tage geschrieben. Verzeichnis: "
          f"{len(d['tage'])} Tage, {d['von']} bis {d['bis']}")


if __name__ == "__main__":
    main(sys.argv)
