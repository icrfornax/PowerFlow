"""Holt Leitungen und Umspannwerke aus OpenStreetMap ueber die Overpass-API.

Aufruf:  python scripts/fetch-netz.py              (alle Ebenen)
         python scripts/fetch-netz.py hoechst      (nur 220/380/400 kV)
         python scripts/fetch-netz.py hoch         (nur 110 kV)
         python scripts/fetch-netz.py werke        (nur Umspannwerke)

Das ist ein SELTEN-SKRIPT, kein Teil der taeglichen Abrufkette. Netzgeometrie
aendert sich nicht taeglich. Ein Lauf dauert einige Minuten und laedt zweistellige
Megabytes von einem gemeinnuetzig betriebenen Dienst -- nicht ohne Grund starten.

LIZENZ -- WICHTIG UND ANDERS ALS DER REST
-----------------------------------------
OpenStreetMap steht unter der **Open Database License 1.0 (ODbL)**, nicht unter
CC BY 4.0 wie SMARD und nicht gemeinfrei wie Natural Earth.

Daraus folgt:
  * Namensnennung woertlich: "© OpenStreetMap contributors"
  * Share-alike: wer eine abgeleitete DATENBANK weitergibt, muss sie wieder
    unter ODbL stellen. Die erzeugten Dateien unter data/netz-*.json sind eine
    solche abgeleitete Datenbank.
  * Der Code dieses Repositories bleibt MIT. Die Lizenzen gelten getrennt und
    stehen in LIZENZ-DATEN.md.

WAS OSM NICHT LIEFERT
---------------------
Geografie und Spannungsebene -- **keine Fluesse und keine Auslastung**. Eine
gezeichnete Leitung bleibt eine Linie ohne Zahl. Das muss auf der Karte stehen,
sonst liest es jemand als Lastfluss. Siehe docs/beleg-netzgeometrie.md.

Ausserdem ist OSM eine Gemeinschaftserhebung, keine amtliche Quelle. Sie kann
unvollstaendig oder veraltet sein. Das wird auf der Seite benannt.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import ssl
import sys
import time
import urllib.parse
import urllib.request

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "PowerFlow/0.1 (+https://github.com/icrfornax/PowerFlow)"

QUELLE = "OpenStreetMap, https://www.openstreetmap.org/"
LIZENZ = "ODbL 1.0 -- https://opendatacommons.org/licenses/odbl/1-0/"
NAMENSNENNUNG = "© OpenStreetMap contributors"

# Ausschnitt Deutschland, grosszuegig. Wird nur zur Plausibilitaetspruefung
# benutzt, nicht zum Filtern -- gefiltert wird ueber das Staatsgebiet.
RAHMEN = (5.5, 15.5, 47.0, 55.5)

ABFRAGEN = {
    # Hoechstspannung. Das voltage-Feld kann mehrere Werte mit Semikolon
    # enthalten ("380000;110000"), deshalb die Wortgrenzen im Regex.
    "hoechst": {
        "datei": "netz-hoechstspannung.json",
        "titel": "Hoechstspannungsleitungen 220 kV und darueber",
        "ql": ('way["power"="line"]["voltage"~"(^|;)(380000|400000|220000)(;|$)"]'
               '(area.de);'),
        "art": "linie",
    },
    "hoch": {
        "datei": "netz-hochspannung.json",
        "titel": "Hochspannungsleitungen 110 kV",
        "ql": 'way["power"="line"]["voltage"~"(^|;)110000(;|$)"](area.de);',
        "art": "linie",
    },
    # Umspannwerke ab 110 kV. Sie liegen als Flaeche oder Relation vor; fuer
    # eine Karte im Landesmassstab genuegt der Mittelpunkt.
    "werke": {
        "datei": "netz-umspannwerke.json",
        "titel": "Umspannwerke ab 110 kV",
        "ql": ('nwr["power"="substation"]'
               '["voltage"~"(^|;)(110000|220000|380000|400000)(;|$)"](area.de);'),
        "art": "punkt",
    },
}


def _kontext() -> "ssl.SSLContext":
    """TLS-Kontext fuer Overpass.

    Der Standardkontext von Python scheitert unter Windows an der Kette von
    overpass-api.de mit "certificate has expired" -- im mitgelieferten
    Zertifikatsspeicher steckt ein abgelaufenes Wurzelzertifikat. Mit dem
    aktuellen Speicher von certifi gelingt der Handschlag.

    Die Pruefung wird NICHT abgeschaltet. certifi ist nur ein aktuellerer
    Speicher, kein Verzicht auf Sicherheit. Ist certifi nicht da -- etwa auf den
    Linux-Runnern, deren Systemspeicher aktuell ist --, gilt der Standard.
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def frage(ql: str, art: str) -> list[dict]:
    ausgabe = "out geom;" if art == "linie" else "out center tags;"
    text = (f'[out:json][timeout:900];\n'
            f'area["ISO3166-1"="DE"][admin_level=2]->.de;\n'
            f'{ql}\n{ausgabe}')
    daten = urllib.parse.urlencode({"data": text}).encode("utf-8")
    anfrage = urllib.request.Request(
        OVERPASS, data=daten, headers={"User-Agent": USER_AGENT})
    beginn = time.time()
    with urllib.request.urlopen(anfrage, timeout=960, context=_kontext()) as antwort:
        roh = antwort.read()
    print(f"    {len(roh):,} Bytes in {time.time() - beginn:.0f} s")
    return json.loads(roh.decode("utf-8"))["elements"]


def hoechste_spannung(tags: dict) -> int | None:
    """Groesste Spannung aus dem voltage-Feld, in Volt.

    OSM erlaubt mehrere Werte mit Semikolon. Fuer die Darstellung zaehlt die
    hoechste -- eine Leitung mit "380000;110000" ist eine 380-kV-Trasse, die
    zusaetzlich 110-kV-Systeme traegt.
    """
    roh = tags.get("voltage") or ""
    werte = []
    for teil in roh.split(";"):
        teil = teil.strip()
        if teil.isdigit():
            werte.append(int(teil))
    return max(werte) if werte else None


def im_rahmen(lon: float, lat: float) -> bool:
    return RAHMEN[0] <= lon <= RAHMEN[1] and RAHMEN[2] <= lat <= RAHMEN[3]


def linien(elemente: list[dict]) -> tuple[list, dict]:
    raus, verworfen = [], {"ohne_geometrie": 0, "ohne_spannung": 0, "ausserhalb": 0}
    for w in elemente:
        geo = w.get("geometry")
        if not geo or len(geo) < 2:
            verworfen["ohne_geometrie"] += 1
            continue
        volt = hoechste_spannung(w.get("tags", {}))
        if volt is None:
            verworfen["ohne_spannung"] += 1
            continue
        # Koordinaten auf vier Nachkommastellen: rund 11 m. Feiner braucht eine
        # Landeskarte nicht, und es halbiert die Dateigroesse.
        punkte = [[round(p["lon"], 4), round(p["lat"], 4)] for p in geo]
        if not any(im_rahmen(x, y) for x, y in punkte):
            verworfen["ausserhalb"] += 1
            continue
        # Aufeinanderfolgende gleiche Punkte nach dem Runden zusammenfassen.
        knapp = [punkte[0]]
        for p in punkte[1:]:
            if p != knapp[-1]:
                knapp.append(p)
        if len(knapp) < 2:
            verworfen["ohne_geometrie"] += 1
            continue
        eintrag = {"v": volt, "p": knapp}
        betreiber = (w.get("tags", {}).get("operator") or "").strip()
        if betreiber:
            eintrag["b"] = betreiber
        raus.append(eintrag)
    return raus, verworfen


def punkte(elemente: list[dict]) -> tuple[list, dict]:
    raus, verworfen = [], {"ohne_ort": 0, "ohne_spannung": 0, "ausserhalb": 0}
    for e in elemente:
        if "center" in e:
            lon, lat = e["center"]["lon"], e["center"]["lat"]
        elif "lon" in e:
            lon, lat = e["lon"], e["lat"]
        else:
            verworfen["ohne_ort"] += 1
            continue
        tags = e.get("tags", {})
        volt = hoechste_spannung(tags)
        if volt is None:
            verworfen["ohne_spannung"] += 1
            continue
        if not im_rahmen(lon, lat):
            verworfen["ausserhalb"] += 1
            continue
        eintrag = {"v": volt, "lon": round(lon, 4), "lat": round(lat, 4)}
        for schluessel, kurz in (("name", "n"), ("operator", "b")):
            wert = (tags.get(schluessel) or "").strip()
            if wert:
                eintrag[kurz] = wert
        raus.append(eintrag)
    return raus, verworfen


def schreibe(schluessel: str, eintraege: list, verworfen: dict) -> None:
    a = ABFRAGEN[schluessel]
    doc = {
        "_quelle": QUELLE,
        "_lizenz": LIZENZ,
        "_namensnennung": NAMENSNENNUNG,
        "_hinweis": (
            "GEOGRAFIE UND SPANNUNGSEBENE, KEINE MESSUNG. Diese Datei sagt, wo "
            "eine Leitung oder ein Umspannwerk liegt und fuer welche Spannung "
            "es gebaut ist -- nicht, wie viel Strom fliesst. Fluesse auf "
            "einzelnen Leitungen werden nach § 23c Abs. 2 EnWG nicht "
            "veroeffentlicht. OpenStreetMap ist eine Gemeinschaftserhebung, "
            "keine amtliche Quelle; sie kann unvollstaendig oder veraltet sein. "
            "Koordinaten in GeoJSON-Reihenfolge [Laenge, Breite]. "
            "Feld v = hoechste Spannung in Volt, b = Betreiber, "
            "p = Stuetzpunkte der Leitung, n = Name."
        ),
        "_share_alike": (
            "ODbL 1.0: Diese Datei ist eine abgeleitete Datenbank. Wer sie "
            "weitergibt, muss sie wieder unter ODbL stellen. Siehe "
            "LIZENZ-DATEN.md."
        ),
        "titel": a["titel"],
        "abgerufen": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "art": a["art"],
        "anzahl": len(eintraege),
        "verworfen": verworfen,
        "objekte": eintraege,
    }
    pfad = DATA / a["datei"]
    pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")
    print(f"    geschrieben: data/{a['datei']}  ({pfad.stat().st_size:,} Bytes, "
          f"{len(eintraege):,} Objekte, verworfen: {verworfen})")


def main(argv: list[str]) -> int:
    DATA.mkdir(exist_ok=True)
    schluessel = argv or list(ABFRAGEN)
    for s in schluessel:
        if s not in ABFRAGEN:
            print(f"unbekannt: {s}. Moeglich: {', '.join(ABFRAGEN)}")
            return 2
        a = ABFRAGEN[s]
        print(f"  {a['titel']} ...", flush=True)
        try:
            elemente = frage(a["ql"], a["art"])
        except Exception as fehler:  # Overpass ist ein gemeinnuetziger Dienst
            print(f"    FEHLGESCHLAGEN: {fehler}")
            print("    Kein Abbruch der uebrigen Ebenen. Spaeter erneut versuchen.")
            continue
        eintraege, verworfen = (linien(elemente) if a["art"] == "linie"
                                else punkte(elemente))
        schreibe(s, eintraege, verworfen)
        if s != schluessel[-1]:
            time.sleep(5)  # dem Dienst Luft lassen
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
