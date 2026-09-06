"""Zugriff auf die Eurostat Dissemination API. Kein Schluessel, keine Anmeldung.

Eurostat ist in diesem Projekt die EINZIGE Quelle, die nicht ueber ENTSO-E
laeuft. SMARD bekommt seine Zahlen von ENTSO-E, Energy-Charts veroeffentlicht
SMARD weiter -- ein Abgleich zwischen den beiden ist deshalb eine
Konsistenzpruefung und keine Gegenprobe. Eurostat erhebt ueber die NATIONALEN
VERWALTUNGEN nach Verordnung (EG) Nr. 1099/2008; fuer Deutschland ist das der
Weg ueber das Statistische Bundesamt, nicht ueber die Uebertragungsnetz-
betreiber. Belegt in docs/beleg-gegenprobe.md.

LIZENZ: CC BY 4.0, Beschluss 2011/833/EU der Kommission. Gewerbliche
Weiterverwendung ist fuer Daten der EU-Mitgliedstaaten ausdruecklich erlaubt.
Die Namensnennung verlangt DOI und Abrufdatum -- beides steht in der Datei.

DAS ANTWORTFORMAT IST JSON-stat 2.0, und sein Wertefeld ist eine FLACHE Karte:
der Schluessel ist ein einziger Index ueber das Kreuzprodukt aller Dimensionen,
gebildet in der Reihenfolge von `id` mit den Laengen aus `size`. Diese
Reihenfolge wird HIER AUS DEM DOKUMENT GELESEN und nicht angenommen -- sie
unterscheidet sich zwischen den Datensaetzen (nrg_bal_c hat siec an dritter,
nrg_cb_e an dritter Stelle bei anderer Belegung), und wer sie raet, bekommt
lautlos die Zahl eines anderen Energietraegers.

DEZIMALTRENNZEICHEN: keines. Die Werte sind echte JSON-Zahlen, kein Text.
Nachgesehen am 06.09.2026 an nrg_bal_c fuer DE; `pruefe_zahlen()` prueft den
Typ bei jedem Lauf, damit ein Formatwechsel der Quelle nicht still durchgeht.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

BASIS = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
KOPF = {"User-Agent": "PowerFlow/1.0 (+https://github.com/icrfornax/PowerFlow)"}


class Nichtvorhanden(Exception):
    """Die Abfrage ist gueltig, aber es gibt keine Daten dazu."""


class Tabelle:
    """Ein JSON-stat-Dokument, adressierbar ueber die Codes seiner Dimensionen."""

    def __init__(self, doc: dict) -> None:
        self.doc = doc
        self.id = doc["id"]
        self.size = doc["size"]
        if len(self.id) != len(self.size):
            raise SystemExit("ABBRUCH: id und size passen nicht zusammen. "
                             "Das Antwortformat hat sich geaendert.")
        # Schrittweite je Dimension, von hinten aufgebaut -- so, wie JSON-stat
        # den flachen Index bildet.
        self.schritt = [1] * len(self.size)
        for i in range(len(self.size) - 2, -1, -1):
            self.schritt[i] = self.schritt[i + 1] * self.size[i + 1]
        self.index = {d: doc["dimension"][d]["category"]["index"] for d in self.id}
        self.label = {d: doc["dimension"][d]["category"].get("label", {})
                      for d in self.id}

    def codes(self, dimension: str) -> list[str]:
        return list(self.index[dimension])

    def bezeichnung(self, dimension: str, code: str) -> str:
        return self.label[dimension].get(code, code)

    def wert(self, **auswahl: str) -> float | None:
        """Ein einzelner Wert. Fehlende Codes geben None, keine Ausnahme --
        eine Reihe, die es fuer ein Jahr nicht gibt, ist keine Stoerung."""
        stelle = 0
        for i, d in enumerate(self.id):
            code = auswahl.get(d)
            if code is None:
                if self.size[i] != 1:
                    raise SystemExit(f"ABBRUCH: Dimension '{d}' hat "
                                     f"{self.size[i]} Auspraegungen und muss "
                                     "ausgewaehlt werden.")
                code = next(iter(self.index[d]))
            wo = self.index[d].get(str(code))
            if wo is None:
                return None
            stelle += wo * self.schritt[i]
        return self.doc["value"].get(str(stelle))

    def einheit(self) -> str:
        return next(iter(self.index["unit"]))

    def stand(self) -> str | None:
        """Wann Eurostat die Daten zuletzt geaendert hat -- nicht die Struktur."""
        for a in ((self.doc.get("extension") or {}).get("annotation") or []):
            if a.get("type") == "UPDATE_DATA":
                return (a.get("date") or "")[:10]
        return (self.doc.get("updated") or "")[:10] or None

    def doi(self) -> str:
        """Die DOI gehoert in die Namensnennung -- Eurostat verlangt sie."""
        return "10.2908/" + ((self.doc.get("extension") or {}).get("id") or "")

    def pruefe_zahlen(self) -> int:
        """Zaehlt Werte, die KEINE Zahl sind. Ein Formatwechsel der Quelle darf
        nicht still durchgehen -- genau so ist bei netztransparenz.de ein
        Viertel der Redispatch-Arbeit verschwunden."""
        return sum(1 for v in self.doc["value"].values()
                   if not isinstance(v, (int, float)) or isinstance(v, bool))


def hole(datensatz: str, **filter: str) -> Tabelle:
    """Ein Datensatz mit Filtern. Wirft Nichtvorhanden, wenn nichts passt."""
    p = dict(filter)
    p.setdefault("format", "JSON")
    p.setdefault("lang", "EN")
    url = f"{BASIS}/{datensatz}?" + urllib.parse.urlencode(p)
    bitte = urllib.request.Request(url, headers=KOPF)
    try:
        with urllib.request.urlopen(bitte, timeout=180) as antwort:
            doc = json.loads(antwort.read().decode("utf-8"))
    except urllib.error.HTTPError as fehler:
        if fehler.code in (400, 404):
            raise Nichtvorhanden(f"{datensatz}: {fehler.code}") from fehler
        raise
    if "value" not in doc or not doc["value"]:
        raise Nichtvorhanden(f"{datensatz}: leere Antwort")
    t = Tabelle(doc)
    schlecht = t.pruefe_zahlen()
    if schlecht:
        raise SystemExit(f"ABBRUCH: {schlecht} Werte in {datensatz} sind keine "
                         "Zahlen. Das Antwortformat hat sich geaendert -- erst "
                         "nachsehen, nicht umwandeln.")
    return t
