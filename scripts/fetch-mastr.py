"""Windparks aus dem Marktstammdatenregister.

Aufruf:  python scripts/fetch-mastr.py
         python scripts/fetch-mastr.py --pruefen  (nur nachrechnen, nichts schreiben)

WARUM DER UMWEG UEBER HTTP-RANGE
Der Gesamtdatenexport ist ein ZIP von 3,16 GB. Gebraucht werden daraus zwei
Dateien: Katalogwerte.xml (0,4 MB) und EinheitenWind.xml (8 MB gepackt). Ein ZIP
traegt sein Inhaltsverzeichnis am Ende; mit Range-Anfragen laesst sich gezielt
lesen, was gebraucht wird -- 9,5 statt 3.160 MB.

SOLAR IST GEPRUEFT UND BEWUSST NICHT DABEI
Die 65 EinheitenSolar_*.xml sind zusammen 1,08 GB gepackt, und selbst ab 1 MW
blieben rund elftausend Standorte uebrig. Auf einer Karte, die vom Netz und von
den grossen Erzeugern handelt, ist das kein Zugewinn. Was bei der Pruefung
herauskam -- Feldbelegung, Koordinatenabdeckung, Schwellen -- steht in
docs/beleg-mastr.md, damit niemand die 1,08 GB ein zweites Mal laedt, um
dasselbe herauszufinden.

QUELLE UND LIZENZ
Marktstammdatenregister der Bundesnetzagentur. Die Downloadseite nennt direkt
neben dem XML-Export "Lizenz: Datenlizenz Deutschland - Namensnennung -
Version 2.0". Nach Absatz 3 dieser Lizenz ist im Quellenvermerk anzugeben, DASS
die Daten veraendert wurden -- hier wird gefiltert und je Park zusammengefasst,
also steht das im Kopf jeder erzeugten Datei. Beleg: docs/beleg-mastr.md.

WAS DIESE DATEI IST UND WAS NICHT
Stammdaten: wo eine Anlage steht und was sie kann. NICHT, was sie erzeugt hat.
Die Erzeugung steht in den SMARD-Reihen und wird dort gemessen.
"""

from __future__ import annotations

import collections
import io
import json
import math
import pathlib
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"
SEITE = "https://www.marktstammdatenregister.de/MaStR/Datendownload"
KOPF = {"User-Agent": "PowerFlow/1.0 (+https://github.com/icrfornax/PowerFlow)"}

# Ein Park ab 5 MW. Das sind rund 4.000 Parks und ueber 80 % der installierten
# Windleistung. Die Schwelle ist eine WAHL und wird auf der Seite benannt --
# darunter fehlen im Register ohnehin haeufig die Koordinaten.
WIND_MIN_KW = 5000


def _kontext() -> ssl.SSLContext:
    """Zertifikate von certifi, wenn vorhanden. Pruefung wird NIE abgeschaltet."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


KONTEXT = _kontext()


def hole(url: str, kopf: dict | None = None, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, headers={**KOPF, **(kopf or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=KONTEXT) as a:
        return a.read()


def export_url() -> str:
    """Die Downloadseite nennt den aktuellen Dateinamen mit Datum."""
    seite = hole(SEITE, timeout=120).decode("utf-8", errors="replace")
    namen = sorted(set(re.findall(r"Gesamtdatenexport_\d{8}_[\d.]+\.zip", seite)))
    if not namen:
        raise SystemExit("Auf der Downloadseite steht kein Gesamtdatenexport. "
                         "Seite von Hand ansehen, bevor hier geraten wird.")
    return "https://download.marktstammdatenregister.de/" + namen[-1]


class Fern(io.RawIOBase):
    """Datei-artiger Lesezugriff auf eine entfernte Datei per HTTP-Range."""

    def __init__(self, url: str, groesse: int):
        self.url, self.groesse, self.pos, self.geholt = url, groesse, 0, 0

    def seek(self, off, whence=0):
        self.pos = (off if whence == 0
                    else self.pos + off if whence == 1
                    else self.groesse + off)
        return self.pos

    def tell(self):
        return self.pos

    def seekable(self):
        return True

    def readable(self):
        return True

    # RawIOBase verlangt readinto; read() ruft es selbst auf.
    def readinto(self, puffer):
        n = len(puffer)
        if n == 0 or self.pos >= self.groesse:
            return 0
        bis = min(self.groesse - 1, self.pos + n - 1)
        daten = hole(self.url, {"Range": f"bytes={self.pos}-{bis}"})
        puffer[:len(daten)] = daten
        self.pos += len(daten)
        self.geholt += len(daten)
        return len(daten)


def entziffern(roh: bytes) -> str:
    """Die Dateien des Exports sind UTF-16 mit Byte-Order-Mark."""
    if roh[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return roh.decode("utf-16")
    return roh.decode("utf-8", errors="replace")


def saetze(z: zipfile.ZipFile, name: str) -> list[dict]:
    wurzel = ET.fromstring(entziffern(z.read(name)))
    return [{f.tag: f.text for f in k} for k in wurzel]


def katalog(z: zipfile.ZipFile) -> dict:
    werte = {}
    for k in ET.fromstring(entziffern(z.read("Katalogwerte.xml"))):
        d = {f.tag: f.text for f in k}
        werte[d.get("Id")] = d.get("Wert")
    return werte


# Was beim Lesen nicht aufging. Ein stiller Ausfall ist der gefaehrlichste
# Fehler dieser Art: bei Redispatch hat ein "return 0.0" im Ausnahmefall
# 27 % der Arbeit verschwinden lassen, ohne dass es jemand merkte. Hier wird
# deshalb gezaehlt, und main() bricht ab, wenn die Zahl nicht winzig ist.
UNLESBAR = collections.Counter()


def zahl(x) -> float:
    """Eine Zahl aus dem Export. Das Trennzeichen ist dort ein PUNKT.

    Nachgesehen und nicht angenommen: "3000.000" fuer eine 3-MW-Anlage,
    "9.739374" fuer einen Laengengrad -- anders als bei netztransparenz.de, wo
    ein Komma steht. Ein Komma wird hier trotzdem behandelt, falls die Quelle
    ihr Format aendert. Aber es wird MITGEZAEHLT, damit die Aenderung
    auffaellt, statt still durchzugehen.
    """
    if x is None or (isinstance(x, str) and not x.strip()):
        UNLESBAR["leer"] += 1
        return 0.0
    s = x.strip() if isinstance(x, str) else x
    try:
        return float(s)
    except (TypeError, ValueError):
        pass
    if isinstance(s, str) and "," in s:
        try:
            wert = float(s.replace(".", "").replace(",", "."))
            UNLESBAR["komma"] += 1
            return wert
        except ValueError:
            pass
    UNLESBAR["unlesbar"] += 1
    return 0.0


def wind(z, werte, betrieb):
    """Einzelne Windenergieanlagen zu Parks zusammenfassen.

    Zusammengefasst wird ueber NameWindpark -- das ist die Angabe des
    Betreibers im Register, nicht meine Erfindung. Eine Anlage ohne Parknamen
    bleibt fuer sich. Der Ort des Parks ist der Mittelwert der Anlagenorte;
    das ist eine Rechnung und wird als solche benannt.
    """
    roh = saetze(z, "EinheitenWind.xml")
    gruppen: dict = {}
    einzeln = 0
    ohne_ort = 0
    gesamt_kw = 0.0
    for s in roh:
        if s.get("EinheitBetriebsstatus") not in betrieb:
            continue
        kw = zahl(s.get("Nettonennleistung"))
        gesamt_kw += kw
        if not (s.get("Laengengrad") and s.get("Breitengrad")):
            ohne_ort += 1
            continue
        see = werte.get(s.get("WindAnLandOderAufSee"), "")
        name = (s.get("NameWindpark") or "").strip()
        if not name:
            name = (s.get("NameStromerzeugungseinheit") or "Windenergieanlage").strip()
            einzeln += 1
        g = gruppen.setdefault((name, see), {"kw": 0.0, "n": 0, "lon": 0.0, "lat": 0.0,
                                             "jahr": None})
        g["kw"] += kw
        g["n"] += 1
        g["lon"] += float(s["Laengengrad"])
        g["lat"] += float(s["Breitengrad"])
        j = (s.get("Inbetriebnahmedatum") or "")[:4]
        if j.isdigit() and (g["jahr"] is None or j < g["jahr"]):
            g["jahr"] = j

    parks = []
    for (name, see), g in gruppen.items():
        if g["kw"] < WIND_MIN_KW:
            continue
        parks.append({
            "n": name[:60],
            "kw": round(g["kw"], 1),
            "a": g["n"],
            "lon": round(g["lon"] / g["n"], 5),
            "lat": round(g["lat"] / g["n"], 5),
            "see": 1 if see == "Windkraft auf See" else 0,
            "j": g["jahr"],
        })
    parks.sort(key=lambda p: -p["kw"])
    return parks, {
        "einheiten_in_betrieb": sum(1 for s in roh
                                    if s.get("EinheitBetriebsstatus") in betrieb),
        "einheiten_gesamt": len(roh),
        "leistung_in_betrieb_gw": round(gesamt_kw / 1e6, 2),
        "ohne_koordinate": ohne_ort,
        "gruppen_gesamt": len(gruppen),
        "anlagen_ohne_parknamen": einzeln,
    }


def schreiben(pfad, titel, was, parks, kennzahlen, url, schwelle, verfahren):
    doc = {
        "_quelle": "Marktstammdatenregister, Bundesnetzagentur",
        "_lizenz": "Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0)",
        "_lizenz_url": "https://www.govdata.de/dl-de/by-2-0",
        "_namensnennung": ("Marktstammdatenregister, Bundesnetzagentur, "
                           "Datenlizenz Deutschland - Namensnennung - Version 2.0"),
        "_veraendert": ("JA. Nach Absatz 3 der Lizenz anzugeben: die Daten sind "
                        "gefiltert und zusammengefasst. " + verfahren),
        "_hinweis": ("STAMMDATEN, KEINE MESSUNG. Diese Datei sagt, wo eine Anlage "
                     "steht und was sie kann -- nicht, was sie erzeugt hat. Die "
                     "Erzeugung steht in den SMARD-Reihen."),
        "_datensatz": url,
        "titel": titel,
        "art": was,
        "schwelle_kw": schwelle,
        "abgerufen": __import__("datetime").datetime.now().astimezone().isoformat(
            timespec="seconds"),
        "kennzahlen": kennzahlen,
        # Was beim Lesen der Zahlen aufgefallen ist. Leer heisst: nichts.
        "beim_lesen_aufgefallen": dict(UNLESBAR),
        "anzahl": len(parks),
        "leistung_gw": round(sum(p["kw"] for p in parks) / 1e6, 2),
        "objekte": parks,
    }
    pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    print(f"  geschrieben: {pfad.relative_to(WURZEL)} "
          f"({pfad.stat().st_size / 1e6:.2f} MB, {len(parks)} Objekte, "
          f"{doc['leistung_gw']} GW)")


def main(pruefen: bool) -> int:
    url = export_url()
    print(f"  Export: {url.rsplit('/', 1)[-1]}")
    req = urllib.request.Request(url, method="HEAD", headers=KOPF)
    with urllib.request.urlopen(req, timeout=120, context=KONTEXT) as a:
        groesse = int(a.headers["Content-Length"])
        if a.headers.get("Accept-Ranges") != "bytes":
            raise SystemExit("Der Server bietet keine Range-Anfragen an. Ohne die "
                             "muessten 3 GB geladen werden -- das macht dieses "
                             "Skript nicht von selbst.")
    print(f"  Groesse: {groesse / 1e9:.2f} GB, Teilabruf moeglich")

    fern = Fern(url, groesse)
    z = zipfile.ZipFile(io.BufferedReader(fern, buffer_size=1 << 20))
    werte = katalog(z)
    betrieb = [c for c, w in werte.items() if w == "In Betrieb"]
    if not betrieb:
        raise SystemExit("Im Katalog steht kein Wert 'In Betrieb'. Der Aufbau des "
                         "Exports hat sich geaendert -- erst ansehen, dann anpassen.")
    print(f"  Katalog: {len(werte)} Werte, 'In Betrieb' = {betrieb}")

    print("\n  Wind ...")
    parks, kw = wind(z, werte, betrieb)
    for k, v in kw.items():
        print(f"    {k:<32} {v}")
    print(f"    Parks ab {WIND_MIN_KW / 1000:.0f} MW: {len(parks)}, "
          f"{sum(p['kw'] for p in parks) / 1e6:.2f} GW")
    if parks:
        g = parks[0]
        print(f"    groesster: {g['n']} -- {g['kw'] / 1000:.1f} MW aus {g['a']} Anlagen")

    # Plausibilitaet: die Summe muss zur gemessenen Spitzenerzeugung passen.
    if kw["leistung_in_betrieb_gw"] < 40 or kw["leistung_in_betrieb_gw"] > 200:
        raise SystemExit(f"ABBRUCH: {kw['leistung_in_betrieb_gw']} GW Wind in Betrieb "
                         "liegt ausserhalb des Plausiblen (40 bis 200 GW).")

    if not pruefen:
        schreiben(DATA / "mastr-wind.json", "Windparks ab "
                  f"{WIND_MIN_KW / 1000:.0f} MW", "wind", parks, kw, url, WIND_MIN_KW,
                  "Einzelne Anlagen sind ueber die Betreiberangabe NameWindpark zu "
                  "Parks zusammengefasst; der Ort eines Parks ist der Mittelwert der "
                  "Anlagenorte. Anlagen ohne Koordinate fehlen.")

    # Waechter: was nicht gelesen werden konnte, darf nicht still verschwinden.
    if UNLESBAR:
        print(f"\n  beim Lesen aufgefallen: {dict(UNLESBAR)}")
    schlimm = UNLESBAR["unlesbar"] + UNLESBAR["komma"]
    if schlimm > max(10, kw["einheiten_gesamt"] * 0.001):
        raise SystemExit(
            f"ABBRUCH: {schlimm} Zahlen liessen sich nicht wie erwartet lesen. "
            "Der Export benutzt einen PUNKT als Dezimaltrennzeichen; weicht das "
            "ab, hat die Quelle ihr Format geaendert. Erst ansehen, dann "
            "weiterbauen -- nicht die Grenze anheben.")

    print(f"\n  uebertragen: {fern.geholt / 1e6:.1f} MB von {groesse / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main("--pruefen" in sys.argv))
