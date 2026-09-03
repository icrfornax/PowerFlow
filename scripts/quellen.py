"""Erzeugt data/quellen.json -- das Quellenverzeichnis der Seite.

Aufruf:  python scripts/quellen.py
         python scripts/quellen.py --negativtest

Es wird aus den TATSAECHLICH vorhandenen Dateien gebaut, nicht von Hand
gepflegt. Damit kann es nicht von der Wirklichkeit abweichen: kommt eine Datei
dazu, taucht sie auf; verschwindet eine, verschwindet sie auch hier.

**Jede Datei unter data/ muss einer Quelle zugeordnet sein.** Findet das Skript
eine, die keinem Muster entspricht, bricht es ab. Eine Zahl ohne Herkunft gibt
es auf dieser Seite nicht -- auch nicht versehentlich.
"""

from __future__ import annotations

import json
import pathlib
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"
REPO = "https://github.com/icrfornax/PowerFlow/tree/main/data"

QUELLEN = {
    "smard": {
        "name": "SMARD, Bundesnetzagentur",
        "url": "https://www.smard.de/",
        "lizenz": "CC BY 4.0",
        "lizenz_url": "https://creativecommons.org/licenses/by/4.0/deed.de",
        "namensnennung": "Bundesnetzagentur | SMARD.de",
        "erhebung": "ENTSO-E, geprueft von der Bundesnetzagentur",
    },
    "naturalearth": {
        "name": "Natural Earth",
        "url": "https://www.naturalearthdata.com/",
        "lizenz": "gemeinfrei (public domain)",
        "lizenz_url": "https://www.naturalearthdata.com/about/terms-of-use/",
        "namensnennung": "keine gefordert; wird trotzdem genannt",
        "erhebung": "Kartografie, Gemeinschaftsprojekt",
    },
    "osm": {
        "name": "OpenStreetMap",
        "url": "https://www.openstreetmap.org/",
        "lizenz": "ODbL 1.0 (Share-alike)",
        "lizenz_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "namensnennung": "© OpenStreetMap contributors",
        "erhebung": "Gemeinschaftserhebung, keine amtliche Quelle",
    },
    "powerflow": {
        "name": "PowerFlow selbst",
        "url": "https://github.com/icrfornax/PowerFlow",
        "lizenz": "MIT (Code); die Inhalte verweisen auf die Quellen darunter",
        "lizenz_url": "https://github.com/icrfornax/PowerFlow/blob/main/LICENSE",
        "namensnennung": "keine gefordert",
        "erhebung": "aus den Dateien dieses Repositorys erzeugt, keine eigene Messung",
    },
    "mastr": {
        "name": "Marktstammdatenregister, Bundesnetzagentur",
        "url": "https://www.marktstammdatenregister.de/MaStR/Datendownload",
        "lizenz": "Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0)",
        "lizenz_url": "https://www.govdata.de/dl-de/by-2-0",
        "namensnennung": ("Marktstammdatenregister, Bundesnetzagentur, "
                          "Datenlizenz Deutschland - Namensnennung - Version 2.0 -- "
                          "Daten gefiltert und je Park zusammengefasst (veraendert)"),
        "erhebung": "amtliches Register; die Betreiber melden ihre Anlagen selbst",
    },
    "abgeleitet": {
        "name": "PowerFlow, abgeleitet -- KEINE Messung",
        "url": "https://github.com/icrfornax/PowerFlow/blob/main/scripts/zonenflaeche.py",
        "lizenz": "ODbL 1.0 (Share-alike), weil aus OpenStreetMap abgeleitet",
        "lizenz_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "namensnennung": "Bundesnetzagentur | SMARD.de; © OpenStreetMap contributors",
        "erhebung": "nicht erhoben, sondern aus belegten Stützpunkten interpoliert; "
                    "die gemessene Trefferquote steht in der Datei und auf der Seite",
    },
    "netztransparenz": {
        "name": "netztransparenz.de -- 50Hertz, Amprion, TenneT, TransnetBW",
        "url": "https://www.netztransparenz.de/",
        "lizenz": "siehe LIZENZ-DATEN.md -- Kette ueber ENTSO-E, seit 03.09.2026 geschlossen",
        "lizenz_url": "https://github.com/icrfornax/PowerFlow/blob/main/LIZENZ-DATEN.md",
        "namensnennung": "netztransparenz.de -- 50Hertz, Amprion, TenneT, TransnetBW",
        "erhebung": "die vier Uebertragungsnetzbetreiber",
    },
    "entsoe": {
        "name": "ENTSO-E Transparency Platform",
        "url": "https://transparency.entsoe.eu/",
        "lizenz": "CC BY 4.0",
        "lizenz_url": "https://creativecommons.org/licenses/by/4.0/deed.de",
        "namensnennung": "ENTSO-E Transparency Platform",
        "erhebung": ("die vier Uebertragungsnetzbetreiber, veroeffentlicht ueber "
                     "die Plattform des Verbands europaeischer "
                     "Uebertragungsnetzbetreiber"),
    },
}

# Muster -> (Quelle, Titel, Inhalt, Beleg, Sammeldatei fuer den Abzug)
GRUPPEN = [
    ("tage-verzeichnis.json", "smard", "Verzeichnis der Tagesreihen",
     "Welche Jahresdatei welchen Zeitraum abdeckt.", "docs/beleg-tagesreihen.md", None),
    ("tage/*.json", "smard", "Tageswerte je Jahr",
     "Netzlast, Residuallast, Pumpspeicherverbrauch, Erzeugung nach zwoelf "
     "Energietraegern, dasselbe je Regelzone, Aussenhandel je Nachbarland, "
     "Grosshandelspreis. Ein Wert je Tag, in MWh.",
     "docs/beleg-smard.md", "tage-verzeichnis.json"),
    ("verlauf-verzeichnis.json", "smard", "Verzeichnis der Stundenreihen",
     "Welche Monatsdatei wie viele Stunden enthaelt.", "docs/beleg-verlauf.md", None),
    ("verlauf/*.json", "smard", "Stundenwerte je Monat",
     "Netzlast, Erzeugung nach Energietraeger und Grosshandelspreis, "
     "ein Wert je Stunde, in MWh bzw. Euro je MWh.",
     "docs/beleg-verlauf.md", "verlauf-verzeichnis.json"),
    ("kraftwerke.json", "smard", "Kraftwerksstandorte",
     "Stammdaten mit Koordinaten, Betreiber, Energietraeger, Nettoleistung und "
     "Bloecken. Aus einem UNDOKUMENTIERTEN Endpunkt.",
     "docs/beleg-kraftwerksdaten.md", None),
    ("grundkarte.json", "naturalearth", "Grundkarte",
     "Umrisse der 16 Bundeslaender und neun Nachbarstaaten, vereinfacht.",
     "docs/beleg-grundkarte.md", None),
    ("netz-hoechstspannung.json", "osm", "Leitungen 220 kV und darueber",
     "Verlauf, Spannungsebene und Betreiber. KEIN Lastfluss.",
     "docs/beleg-netzgeometrie.md", None),
    ("netz-hochspannung.json", "osm", "Leitungen 110 kV",
     "Verlauf und Spannungsebene. KEIN Lastfluss.",
     "docs/beleg-netzgeometrie.md", None),
    ("netz-umspannwerke.json", "osm", "Umspannwerke ab 110 kV",
     "Lage, Spannungsebene, Betreiber, Name.", "docs/beleg-netzgeometrie.md", None),
    ("redispatch-verzeichnis.json", "netztransparenz", "Verzeichnis des Redispatch",
     "Welche Jahresdatei welchen Zeitraum abdeckt.", "docs/beleg-redispatch.md", None),
    ("redispatch/*.json", "netztransparenz", "Redispatch je Jahr",
     "Tagesaggregate: Arbeit nach Richtung, anweisendem Netzbetreiber und "
     "Primaerenergieart, in MWh.", "docs/beleg-redispatch.md",
     "redispatch-verzeichnis.json"),
    ("engpasskosten.json", "entsoe", "Kosten des Engpassmanagements",
     "Je MONAT und Regelzone, in Euro: Gesamtkosten sowie die Posten Redispatch "
     "und Countertrade. Eine feinere Aufloesung gibt es nicht -- Kosten je "
     "Massnahme veroeffentlicht die Quelle nicht.",
     "docs/beleg-engpasskosten.md", None),
    ("luecken.json", "smard", "Luecken der Quelle",
     "Welche Kalendertage und Stunden SMARD bis heute nicht geliefert hat, und "
     "seit wann sie fehlen. SELBST ERHOBEN aus den eigenen Dateien; erzeugt und "
     "nachgeholt von scripts/nachholen.py, geprueft von scripts/validate.py.",
     "docs/beleg-tagesreihen.md", None),
    ("aussenhandel-preis.json", "smard", "Aussenhandel, mengengewichteter Preis",
     "Je Tag vier Summen ueber die Stunden: Preis mal Einfuhr, Einfuhr, Preis mal "
     "Ausfuhr, Ausfuhr. Daraus laesst sich der mengengewichtete Preis jedes "
     "Zeitraums exakt bilden, ohne die Stundendateien zu laden. Selbst gerechnet "
     "aus data/verlauf/; die Formel steht im Kopf der Datei.",
     "docs/beleg-verlauf.md", None),
    ("mastr-wind.json", "mastr", "Windparks ab 5 MW",
     "Ort, Nettonennleistung, Anzahl der Anlagen und Baujahr je Park, an Land und "
     "auf See. Einzelne Anlagen sind ueber die Betreiberangabe NameWindpark "
     "zusammengefasst; der Ort ist der Mittelwert der Anlagenorte. STAMMDATUM, keine "
     "Messung.", "docs/beleg-mastr.md", None),
    # Die EINZIGE abgeleitete Geometrie des Projekts. Sie bekommt eine eigene
    # Quelle, damit sie im Verzeichnis nicht neben den Messungen steht.
    ("regelzonen-flaeche.json", "abgeleitet", "Regelzonen als Flaeche (abgeleitet)",
     "Interpolierte Ausdehnung der vier Regelzonen. Jede Rasterzelle bekommt die "
     "Zone ihres naechstgelegenen Stuetzpunktes; Stuetzpunkte sind Kraftwerke mit "
     "amtlicher Zonenangabe und Leitungen mit eindeutigem Betreiber. KEINE amtliche "
     "Grenze. Trefferquote gegen die amtliche Angabe von 596 Kraftwerken: 93,3 %.",
     "docs/beleg-regelzonenflaeche.md", None),
    # Dieses Verzeichnis ist KEINE Messung und stammt nicht von SMARD -- es
    # wird aus den Dateien dieses Repositorys erzeugt.
    ("quellen.json", "powerflow", "Dieses Verzeichnis",
     "Welcher Datensatz aus welcher Quelle stammt. Aus den vorhandenen Dateien "
     "erzeugt, keine eigene Messung.", None, None),
]


def zeitraum(pfade: list[pathlib.Path]) -> str | None:
    """Abgedeckter Zeitraum, aus den Dateien selbst gelesen."""
    von, bis = None, None
    for p in pfade:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(d.get("tage"), list) and d["tage"]:
            # Die Tagesachse laeuft ueber das ganze Kalenderjahr, auch wo noch
            # keine Werte stehen. Gemeldet wird der BELEGTE Zeitraum, nicht der
            # Kalender -- sonst behauptet das Verzeichnis Daten bis Silvester.
            belegt = [x for x, v in zip(d["tage"], d.get("netzlast") or []) if v is not None]
            if not belegt:
                continue
            a, b = belegt[0], belegt[-1]
        elif isinstance(d.get("tage"), dict) and d["tage"]:
            a, b = min(d["tage"]), max(d["tage"])
        elif d.get("stunden"):
            a, b = d["stunden"][0][:10], d["stunden"][-1][:10]
        else:
            continue
        von = a if von is None or a < von else von
        bis = b if bis is None or b > bis else bis
    return f"{von} bis {bis}" if von else None


def negativtest() -> int:
    """Weist nach, dass der Waechter anschlaegt.

    Eine Pruefung, die nie hat fehlschlagen sehen, ist keine Pruefung. Es wird
    kurz eine Datei ohne Quellenzuordnung angelegt und geprueft, dass der Lauf
    abbricht -- danach wird sie wieder entfernt.
    """
    probe = DATA / "_negativtest-ohne-quelle.json"
    probe.write_text("{}\n", encoding="utf-8", newline="\n")
    try:
        code = main(still=True)
    finally:
        probe.unlink(missing_ok=True)
    if code == 0:
        print("  [PROBL] Der Waechter hat NICHT angeschlagen.")
        return 1
    print("  [ok   ] Der Waechter schlaegt bei einer Datei ohne Quelle an.")
    if main(still=True) != 0:
        print("  [PROBL] Nach dem Entfernen laeuft er nicht wieder durch.")
        return 1
    print("  [ok   ] Nach dem Entfernen laeuft er wieder durch.")
    return 0


def main(still: bool = False) -> int:
    zugeordnet: set[pathlib.Path] = set()
    eintraege = []
    for muster, quelle, titel, inhalt, beleg, sammel in GRUPPEN:
        pfade = sorted(DATA.glob(muster))
        if not pfade:
            continue
        zugeordnet.update(pfade)
        groesse = sum(p.stat().st_size for p in pfade)
        eintraege.append({
            "titel": titel,
            "inhalt": inhalt,
            "quelle": quelle,
            "beleg": beleg,
            "dateien": len(pfade),
            "bytes": groesse,
            "zeitraum": zeitraum(pfade),
            "muster": "data/" + muster,
            # Bei vielen Dateien fuehrt der Abzug auf die Sammeldatei; die
            # Einzeldateien stehen im Repository.
            "abzug": "data/" + (sammel if sammel and len(pfade) > 1
                                else pfade[0].relative_to(DATA).as_posix()),
            "alle": REPO + "/" + muster.split("/")[0] if len(pfade) > 1 else None,
        })

    alle = {p for p in DATA.rglob("*") if p.is_file()}
    fehlend = sorted(p.relative_to(WURZEL).as_posix() for p in alle - zugeordnet)
    if fehlend:
        if not still:
            print("ABBRUCH: Dateien unter data/ ohne Quellenzuordnung:")
            for f in fehlend:
                print("  ", f)
            print("Jede Datei braucht eine Quelle. Muster in GRUPPEN ergaenzen.")
        return 1

    doc = {
        "_hinweis": (
            "Quellenverzeichnis der Seite. Aus den tatsaechlich vorhandenen "
            "Dateien erzeugt, nicht von Hand gepflegt. Jede Datei unter data/ "
            "ist einer Quelle zugeordnet; scripts/quellen.py bricht ab, wenn "
            "eine ohne Zuordnung auftaucht. Alle ZAHLEN dieser Seite sind "
            "gemessen oder als Stammdatum veroeffentlicht -- nichts "
            "modelliert, nichts geschaetzt, nichts erfunden. Genau eine "
            "GEOMETRIE ist abgeleitet: die Flaeche der vier Regelzonen, weil "
            "es dafuer keine amtliche oder offene Geometrie gibt. Sie steht "
            "unter der eigenen Quelle „abgeleitet“, ist auf der Karte "
            "voreingestellt ausgeschaltet und nennt ihre gemessene "
            "Trefferquote."
        ),
        # KEIN Zeitstempel. Der Tuersteher erzeugt dieses Verzeichnis neu und
        # vergleicht es mit dem eingecheckten -- eine Uhrzeit darin macht jeden
        # Vergleich unmoeglich, und genau daran ist er sechs Laeufe lang
        # gescheitert. Wann etwas erzeugt wurde, sagt die Versionsgeschichte.
        "quellen": QUELLEN,
        "datensaetze": eintraege,
        "dateien_gesamt": len(alle),
        "bytes_gesamt": sum(p.stat().st_size for p in alle),
    }
    ziel = DATA / "quellen.json"
    # Das Verzeichnis zaehlt AUCH SICH SELBST. Seine eigene Groesse steht damit
    # erst fest, nachdem es geschrieben ist -- ein Fixpunkt. Deshalb wird so
    # lange neu geschrieben, bis die verzeichnete Groesse der tatsaechlichen
    # entspricht. In der Praxis sind das zwei Durchgaenge. Ohne das kann der
    # Tuersteher, der das Verzeichnis neu erzeugt und vergleicht, nie aufgehen.
    def schreibe():
        ziel.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
                        encoding="utf-8", newline="\n")

    schreibe()
    for _ in range(5):
        eigen = ziel.stat().st_size
        selbst = [e for e in doc["datensaetze"] if e["muster"] == "data/quellen.json"]
        vorher = selbst[0]["bytes"] if selbst else None
        if vorher == eigen:
            break
        if selbst:
            selbst[0]["bytes"] = eigen
        doc["bytes_gesamt"] = sum(p.stat().st_size for p in alle)
        schreibe()
    else:
        raise SystemExit("Die Groesse des Quellenverzeichnisses pendelt. "
                         "Erst ansehen, dann weiterbauen.")
    if not still:
        print(f"  {len(eintraege)} Datensaetze, {len(alle)} Dateien, "
              f"{doc['bytes_gesamt'] / 1e6:.1f} MB")
        for e in eintraege:
            print(f"    {e['titel']:<34} {e['dateien']:>4} Datei(en)  "
                  f"{e['bytes'] / 1e6:>6.2f} MB  {e['zeitraum'] or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(negativtest() if "--negativtest" in sys.argv else main())
