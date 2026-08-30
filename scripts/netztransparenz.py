"""Zugang zur Web-API von netztransparenz.de (die vier Uebertragungsnetzbetreiber).

Nur Python-Standardbibliothek.

ZUGANGSDATEN -- NIE INS REPOSITORY
----------------------------------
Gelesen werden NT_CLIENT_ID und NT_CLIENT_SECRET, in dieser Reihenfolge:

  1. aus der Umgebung  (so laeuft es in GitHub Actions ueber Secrets)
  2. aus einer Datei `.env` im Wurzelverzeichnis (so laeuft es lokal)

`.env` steht in `.gitignore` (Zeile 151) und darf dort nie herausgenommen
werden. Ein einmal gepushtes Geheimnis steht auch nach dem Loeschen noch in der
History und muss neu erzeugt werden.

Dieses Modul gibt Zugangsdaten NIE aus -- auch nicht in Fehlermeldungen.

BELEGTER ABLAUF
---------------
Am 31.08.2026 durch Abruf geprueft, ohne Zugangsdaten:

  POST https://identity.netztransparenz.de/users/connect/token
       grant_type=client_credentials
    -> {"error":"invalid_client"}      (echter OAuth-Endpunkt)

  GET  https://ds.netztransparenz.de/api/v1/data/...
    -> HTTP 401                        (Bearer-Token noetig)

Also OAuth 2.0 mit Client Credentials, das Token als Bearer im Kopf.
"""

from __future__ import annotations

import json
import os
import pathlib
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

WURZEL = pathlib.Path(__file__).resolve().parent.parent

TOKEN_URL = "https://identity.netztransparenz.de/users/connect/token"
API_BASIS = "https://ds.netztransparenz.de/api/v1"
USER_AGENT = "PowerFlow/0.1 (+https://github.com/icrfornax/PowerFlow)"


class KeinZugang(RuntimeError):
    """Es sind keine Zugangsdaten hinterlegt oder sie werden abgelehnt."""


def _kontext() -> ssl.SSLContext:
    """TLS-Kontext mit aktuellem Zertifikatsspeicher, falls certifi da ist.

    Dieselbe Ruecksicht wie bei Overpass: der mitgelieferte Speicher von Python
    ist unter Windows zu alt. Die Pruefung wird NICHT abgeschaltet.
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _aus_env_datei() -> dict[str, str]:
    pfad = WURZEL / ".env"
    if not pfad.is_file():
        return {}
    werte = {}
    for zeile in pfad.read_text(encoding="utf-8").splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        name, _, wert = zeile.partition("=")
        werte[name.strip()] = wert.strip().strip('"').strip("'")
    return werte


def zugangsdaten() -> tuple[str, str]:
    datei = _aus_env_datei()
    kennung = os.environ.get("NT_CLIENT_ID") or datei.get("NT_CLIENT_ID")
    geheim = os.environ.get("NT_CLIENT_SECRET") or datei.get("NT_CLIENT_SECRET")
    if not kennung or not geheim:
        raise KeinZugang(
            "NT_CLIENT_ID und NT_CLIENT_SECRET fehlen.\n"
            "  Lokal:  eine Datei .env im Wurzelverzeichnis anlegen mit\n"
            "            NT_CLIENT_ID=...\n"
            "            NT_CLIENT_SECRET=...\n"
            "          .env ist gitignored und bleibt es.\n"
            "  In CI:  als GitHub Actions Secrets hinterlegen.\n"
            "  Woher:  https://api-portal.netztransparenz.de/ -- siehe\n"
            "          docs/beleg-redispatch.md"
        )
    return kennung, geheim


_zwischenspeicher: dict[str, object] = {}


def token() -> str:
    """Bearer-Token holen. Wird bis kurz vor Ablauf wiederverwendet."""
    jetzt = time.time()
    if _zwischenspeicher.get("gueltig_bis", 0) > jetzt + 30:
        return _zwischenspeicher["token"]  # type: ignore[return-value]

    kennung, geheim = zugangsdaten()
    daten = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": kennung,
        "client_secret": geheim,
    }).encode("utf-8")
    anfrage = urllib.request.Request(TOKEN_URL, data=daten, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
    })
    try:
        with urllib.request.urlopen(anfrage, timeout=60, context=_kontext()) as antwort:
            k = json.loads(antwort.read().decode("utf-8"))
    except urllib.error.HTTPError as fehler:
        rumpf = fehler.read().decode("utf-8", "replace")[:200]
        # Der Rumpf enthaelt nur die Fehlerkennung des Servers, keine
        # Zugangsdaten -- die stehen ausschliesslich in der Anfrage.
        raise KeinZugang(
            f"Token abgelehnt (HTTP {fehler.code}): {rumpf}\n"
            "  invalid_client heisst: Kennung oder Geheimnis stimmen nicht, oder\n"
            "  der Zugang ist noch nicht freigeschaltet."
        ) from None
    _zwischenspeicher["token"] = k["access_token"]
    _zwischenspeicher["gueltig_bis"] = jetzt + float(k.get("expires_in", 300))
    return k["access_token"]


def hole(pfad: str, roh: bool = False):
    """GET auf die Daten-API. `pfad` ohne fuehrenden Schraegstrich.

    Die API liefert CSV, ausser bei einzelnen Reihen. Deshalb `roh=True` fuer
    Text und sonst der Versuch, JSON zu lesen.
    """
    url = f"{API_BASIS}/{pfad.lstrip('/')}"
    anfrage = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token(),
        "User-Agent": USER_AGENT,
    })
    with urllib.request.urlopen(anfrage, timeout=120, context=_kontext()) as antwort:
        text = antwort.read().decode("utf-8-sig", "replace")
    if roh:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text
