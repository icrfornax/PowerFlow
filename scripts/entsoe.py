"""Zugang zur RESTful API der ENTSO-E Transparency Platform.

Nur Python-Standardbibliothek.

ZUGANGSDATEN -- NIE INS REPOSITORY
----------------------------------
Gelesen wird ENTSOE_TOKEN, in dieser Reihenfolge:

  1. aus der Umgebung  (so laeuft es in GitHub Actions ueber Secrets)
  2. aus einer Datei `.env` im Wurzelverzeichnis (so laeuft es lokal)

`.env` steht in `.gitignore` und darf dort nie herausgenommen werden. Dieses
Modul gibt den Schluessel NIE aus -- auch nicht in Fehlermeldungen; die
Ausnahmetexte werden vor der Weitergabe von ihm gesaeubert.

BELEGTER ABLAUF -- am 03.09.2026 durch Abruf geprueft
-----------------------------------------------------
  ohne Token          -> HTTP 401, <Reason><text>Authentication failed.</text>
  mit falschem Token  -> HTTP 401, derselbe Text
  mit dem Schluessel  -> HTTP 200 und ein Marktdokument

Der Schluessel haengt als Query-Parameter `securityToken` an der URL; einen
Kopfzeilen-Weg bietet die Plattform nicht an.

WAS DIE ANTWORTEN GEMEINSAM HABEN
---------------------------------
* XML mit Namensraum, der je Dokumentart wechselt. Deshalb wird der Namensraum
  aus dem Wurzelelement GELESEN und nicht angenommen.
* Ist nichts da, kommt HTTP 200 mit einem `Acknowledgement_MarketDocument`.
  Das ist eine Antwort, kein Fehler -- und muss vom Aufrufer unterschieden
  werden koennen.
* Zahlen stehen als echte XML-Zahlen mit **PUNKT** als Dezimaltrennzeichen
  ("-84430.14"). Nachgesehen am 03.09.2026 an documentType A92, nicht
  angenommen -- die Regel dazu steht in CLAUDE.md.
* Die Abfragegroesse ist begrenzt: ein volles Jahr auf einmal beantwortet die
  Plattform mit HTTP 400 ("The number of instances exceeds the allowed
  maximum"). Monatsweise fragen.
"""

from __future__ import annotations

import os
import pathlib
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

WURZEL = pathlib.Path(__file__).resolve().parent.parent

API = "https://web-api.tp.entsoe.eu/api"
USER_AGENT = "PowerFlow/0.1 (+https://github.com/icrfornax/PowerFlow)"
VERSUCHE = 4
WARTEN_S = 3.0

# Regelzonen (Control Areas). Die Codes sind am 03.09.2026 durch Abruf
# bestaetigt: mit der Gebotszone 10Y1001A1001A82H antwortet die Plattform bei
# Redispatch und Engpasskosten mit "No matching data found", mit diesen vier
# kommen Dokumente. Gebotszone ist NICHT gleich Regelzone.
REGELZONEN = {
    "50Hertz": "10YDE-VE-------2",
    "Amprion": "10YDE-RWENET---I",
    "TenneT DE": "10YDE-EON------1",
    "TransnetBW": "10YDE-ENBW-----N",
}


class KeinZugang(RuntimeError):
    """Es ist kein Schluessel hinterlegt oder er wird abgelehnt."""


class Nichtvorhanden(RuntimeError):
    """Die Plattform hat geantwortet, hat aber keine Daten dazu."""


def _kontext() -> ssl.SSLContext:
    """TLS-Kontext mit aktuellem Zertifikatsspeicher, falls certifi da ist.

    Dieselbe Ruecksicht wie bei den anderen Zugaengen: der mitgelieferte
    Speicher von Python ist unter Windows zu alt. Die Pruefung wird NICHT
    abgeschaltet.
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def token() -> str:
    wert = os.environ.get("ENTSOE_TOKEN", "").strip()
    if wert:
        return wert
    datei = WURZEL / ".env"
    if datei.is_file():
        for zeile in datei.read_text(encoding="utf-8").splitlines():
            zeile = zeile.strip()
            if zeile.startswith("ENTSOE_TOKEN=") and not zeile.startswith("#"):
                wert = zeile.split("=", 1)[1].strip()
                if wert:
                    return wert
    raise KeinZugang(
        "Kein ENTSOE_TOKEN. Lokal in .env eintragen, in GitHub Actions als "
        "Secret hinterlegen. Der Schluessel wird bei ENTSO-E im Portal "
        "beantragt (E-Mail an transparency@entsoe.eu, Betreff 'RESTful API "
        "access').")


def _ohne_schluessel(text: str, schluessel: str) -> str:
    """Der Schluessel darf in keiner Meldung stehen -- auch nicht in einer URL."""
    return text.replace(schluessel, "<ENTSOE_TOKEN>") if schluessel else text


def hole(**parameter) -> ET.Element:
    """Ein Marktdokument. Wirft Nichtvorhanden, wenn die Plattform nichts hat.

    Zurueckgegeben wird das geparste Wurzelelement; den Namensraum liest der
    Aufrufer daraus (siehe namensraum()).
    """
    schluessel = token()
    parameter["securityToken"] = schluessel
    url = API + "?" + urllib.parse.urlencode(parameter)
    anfrage = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    letzter: Exception | None = None
    for versuch in range(VERSUCHE):
        try:
            with urllib.request.urlopen(anfrage, timeout=90,
                                        context=_kontext()) as antwort:
                roh = antwort.read()
            break
        except urllib.error.HTTPError as fehler:
            koerper = fehler.read().decode("utf-8", "replace")
            grund = " ".join(koerper.split())[:300]
            if fehler.code == 401:
                raise KeinZugang("ENTSO-E lehnt den Schluessel ab: "
                                 + _ohne_schluessel(grund, schluessel)) from fehler
            if fehler.code == 400:
                # Eine Antwort, kein Aussetzer -- nicht wiederholen.
                raise Nichtvorhanden(_ohne_schluessel(grund, schluessel)) from fehler
            letzter = fehler
        except Exception as fehler:                      # Netz, Zeitueberschreitung
            letzter = fehler
        time.sleep(WARTEN_S * (versuch + 1))
    else:
        raise RuntimeError("ENTSO-E antwortet nicht: "
                           + _ohne_schluessel(str(letzter), schluessel))
    wurzel = ET.fromstring(roh)
    if wurzel.tag.endswith("Acknowledgement_MarketDocument"):
        texte = [(e.text or "").strip() for e in wurzel.iter()
                 if e.tag.endswith("}text")]
        raise Nichtvorhanden(" ".join(texte)[:300])
    return wurzel


def namensraum(wurzel: ET.Element) -> dict:
    """Der Namensraum des Dokuments, aus dem Dokument gelesen.

    Er wechselt je Dokumentart -- A44 (Preise) und A92 (Engpasskosten) haben
    verschiedene. Wer ihn fest einträgt, bekommt beim naechsten Dokumenttyp
    leere Listen und merkt nichts davon.
    """
    return {"n": wurzel.tag.split("}")[0][1:]}
