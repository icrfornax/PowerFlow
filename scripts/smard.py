"""Abrufbausteine fuer die SMARD-Zeitreihen der Bundesnetzagentur.

Nur Python-Standardbibliothek. Keine zusaetzliche Abhaengigkeit.

Quelle:      SMARD, Bundesnetzagentur
Lizenz:      CC BY 4.0
Namensnennung (woertlich gefordert): "Bundesnetzagentur | SMARD.de"
Beleg:       docs/beleg-smard.md, docs/beleg-aussenhandel.md

Einheiten
---------
Alle Zeitreihen liefern eine ENERGIEMENGE JE INTERVALL in MWh, nicht eine
mittlere Leistung. Nachgewiesen aus den Daten selbst: der Stundenwert ist die
Summe der vier Viertelstundenwerte, nicht ihr Mittel (max. Abweichung 0,02 MWh
ueber 168 Stunden). Leistung in MW ergibt sich als Wert / Intervalllaenge in h,
also Wert * 4 bei quarterhour und Wert * 1 bei hour.

Zeit
----
Zeitstempel sind Unix-MILLISEKUNDEN. Die Wochenbloecke beginnen jeweils Montag
00:00 ORTSZEIT (Europe/Berlin); der UTC-Offset wechselt mit der Sommerzeit mit.
Tagesgrenzen deshalb immer ueber zoneinfo bilden, niemals ueber toISOString /
UTC-Arithmetik.
"""

from __future__ import annotations

import datetime as _dt
import json
import time as _time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

BASIS = "https://www.smard.de/app"
TZ = ZoneInfo("Europe/Berlin")

USER_AGENT = "PowerFlow/0.1 (+https://github.com/icrfornax/PowerFlow)"

# ---------------------------------------------------------------------------
# Regionen. Die vier Regelzonen sind eigenstaendig abrufbar und summieren sich
# exakt auf DE (nachgewiesen in docs/beleg-smard.md, Abweichung 0,00 GWh).
# ---------------------------------------------------------------------------

REGION_DE = "DE"
REGELZONEN = ("50Hertz", "TenneT", "Amprion", "TransnetBW")

# ---------------------------------------------------------------------------
# Filter-IDs. Nie als nackte Zahl im Code verwenden.
# Belegt gegen bundesAPI/smard-api (openapi.yaml), abgerufen 29.08.2026.
# ---------------------------------------------------------------------------

LAST_NETZLAST = 410  # Realisierter Stromverbrauch, Gesamt (Netzlast)
LAST_RESIDUAL = 4359  # Residuallast = Netzlast minus Wind on/off minus PV
LAST_PUMPSPEICHER = 4387  # Verbrauch der Pumpspeicher (Einspeicherleistung)

# Realisierte Erzeugung nach Energietraeger.
#
# Kernenergie (1224) gehoert dazu. Sie fehlte hier zuerst, weil die Reihe fuer
# aktuelle Zeitraeume HTTP 404 liefert -- das war ein Fehler: bis zum
# 15.04.2023 hat Kernenergie erheblich beigetragen (2015 noch 84,4 TWh), und
# ohne sie geht die Tagesbilanz aller Jahre bis 2022 um bis zu 27 Prozent nicht
# auf. Der Aufrufer muss den 404 abfangen, statt den Traeger wegzulassen.
ERZEUGUNG = {
    1223: "Braunkohle",
    1224: "Kernenergie",
    1225: "Wind Offshore",
    1226: "Wasserkraft",
    1227: "Sonstige Konventionelle",
    1228: "Sonstige Erneuerbare",
    4066: "Biomasse",
    4067: "Wind Onshore",
    4068: "Photovoltaik",
    4069: "Steinkohle",
    4070: "Pumpspeicher",
    4071: "Erdgas",
}

# Kernenergie: die ID ist gueltig, die Reihe endet am 15.04.2023 23:45.
# Fuer spaetere Zeitraeume liefert SMARD HTTP 404 -- KEIN leeres Array.
ERZEUGUNG_KERNENERGIE = 1224
KERNENERGIE_ENDE = "2023-04-15"

# Physikalischer Stromfluss je Nachbarland, Aufloesung "hour", Einheit MWh.
# Import und Export sind getrennte, vorzeichenlos positive Reihen.
# "netto" ist der physikalische Nettoexport: positiv = Export aus Deutschland,
# negativ = Import nach Deutschland.
#
# Diese IDs stehen in KEINER veroeffentlichten Dokumentation. Sie wurden
# empirisch bestimmt und an zwei voneinander unabhaengigen Wochen gegen die
# Energy-Charts-Reihe cbpf verifiziert (max. Abweichung 0,47 MWh ueber
# 168 Stunden x 11 Laender). Vollstaendiger Nachweis: docs/beleg-aussenhandel.md
AUSSENHANDEL = {
    "Daenemark": {"import": 4782, "export": 4736, "netto": 4927},
    "Frankreich": {"import": 4783, "export": 4737, "netto": 4928},
    "Luxemburg": {"import": 4786, "export": 4738, "netto": 4929},
    "Niederlande": {"import": 4787, "export": 4739, "netto": 4930},
    "Oesterreich": {"import": 4788, "export": 4740, "netto": 4931},
    "Polen": {"import": 4789, "export": 4741, "netto": 4932},
    "Schweden": {"import": 4790, "export": 4742, "netto": 4933},
    "Schweiz": {"import": 4791, "export": 4743, "netto": 4934},
    "Tschechien": {"import": 4792, "export": 4744, "netto": 4935},
    "Norwegen": {"import": 4989, "export": 4988, "netto": 4991},
    "Belgien": {"import": 4993, "export": 4992, "netto": 4995},
}

VIERTELSTUNDE = "quarterhour"
STUNDE = "hour"

# Intervalllaenge in Stunden, zur Umrechnung MWh je Intervall -> MW.
INTERVALL_H = {VIERTELSTUNDE: 0.25, STUNDE: 1.0}


class Nichtvorhanden(LookupError):
    """Die Reihe existiert fuer diesen Zeitraum nicht (HTTP 404).

    Ausdruecklich KEIN Abruffehler. SMARD liefert fuer eine Reihe, die es in
    diesem Zeitraum nicht gibt, kein leeres Array, sondern 404 -- etwa fuer
    Kernenergie nach dem 15.04.2023 oder fuer eine Kraftwerks-productionId in
    der falschen Regelzone. Der Aufrufer muss das von einem echten Ausfall
    unterscheiden koennen.
    """


# Ein Abruf ueber tausende Dateien laeuft irgendwann in einen Aussetzer der
# Gegenstelle. Das ist kein Grund, den ganzen Lauf wegzuwerfen -- aber auch kein
# Grund, still weiterzumachen: nach drei vergeblichen Versuchen fliegt der
# Fehler weiter nach oben.
VERSUCHE = 3
WARTEN_S = 4.0


def _hole(pfad: str) -> dict:
    anfrage = urllib.request.Request(
        BASIS + pfad, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    letzter: Exception | None = None
    for versuch in range(VERSUCHE):
        try:
            with urllib.request.urlopen(anfrage, timeout=60) as antwort:
                return json.loads(antwort.read().decode("utf-8"))
        except urllib.error.HTTPError as fehler:
            # 404 heisst "gibt es nicht" und wird NICHT wiederholt -- das ist
            # eine Antwort, kein Aussetzer.
            if fehler.code == 404:
                raise Nichtvorhanden(pfad) from fehler
            letzter = fehler
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as fehler:
            letzter = fehler
        if versuch < VERSUCHE - 1:
            _time.sleep(WARTEN_S * (versuch + 1))
    raise RuntimeError(f"{pfad}: nach {VERSUCHE} Versuchen aufgegeben") from letzter


def wochenbloecke(filter_id: int, region: str, aufloesung: str) -> list[int]:
    """Verfuegbare Wochen-Zeitstempel (Unix-Millisekunden, Montag 00:00 lokal)."""
    daten = _hole(f"/chart_data/{filter_id}/{region}/index_{aufloesung}.json")
    return daten["timestamps"]


def reihe(filter_id: int, region: str, aufloesung: str, block: int) -> list[list]:
    """Rohe [Zeitstempel, Wert]-Paare eines Wochenblocks.

    SMARD liefert ECHTE JSON-Zahlen -- nachgesehen und nicht angenommen:
    [1704150000000, 1271127.25], Typ int und float. Kein Text, also auch kein
    Dezimaltrennzeichen, das falsch gelesen werden koennte.

    Das wird hier geprueft und nicht geglaubt. Bei netztransparenz.de steht ein
    KOMMA im Text, und weil float("1306,25") scheitert und die Ausnahme still
    verschluckt wurde, sind dort 27 % der Redispatch-Arbeit verschwunden. Sollte
    SMARD je auf Text umstellen, bricht der Abruf hier ab, statt es
    weiterzureichen.
    """
    pfad = (
        f"/chart_data/{filter_id}/{region}/"
        f"{filter_id}_{region}_{aufloesung}_{block}.json"
    )
    serie = _hole(pfad)["series"]
    for zeitpunkt, wert in serie[:50]:
        if not isinstance(zeitpunkt, (int, float)) or not isinstance(
                wert, (int, float, type(None))):
            raise SystemExit(
                f"ABBRUCH: {pfad} liefert Werte als {type(wert).__name__} statt "
                "als Zahl. Die Quelle hat ihr Format geaendert -- erst ansehen, "
                "besonders auf das Dezimaltrennzeichen, dann weiterbauen.")
    return serie


def tagesgrenzen(tag: _dt.date) -> tuple[int, int]:
    """Beginn und Ende eines Kalendertags in Unix-Millisekunden, lokale Zeit.

    Bewusst ueber zoneinfo und nicht ueber eine feste Stundenzahl: an den
    Umstellungstagen hat der Tag 23 bzw. 25 Stunden.
    """
    anfang = _dt.datetime.combine(tag, _dt.time(0), tzinfo=TZ)
    # Ueber den Folgetag statt ueber "plus 24 Stunden": nur so bleibt die
    # Zeitumstellung erhalten und der Tag behaelt seine 23 bzw. 25 Stunden.
    ende = _dt.datetime.combine(tag + _dt.timedelta(days=1), _dt.time(0), tzinfo=TZ)
    return int(anfang.timestamp() * 1000), int(ende.timestamp() * 1000)


def erwartete_punkte(tag: _dt.date, aufloesung: str) -> int:
    """Wie viele Messpunkte der Tag haben muss. 92/96/100 bzw. 23/24/25."""
    von, bis = tagesgrenzen(tag)
    stunden = (bis - von) / 3_600_000
    return round(stunden / INTERVALL_H[aufloesung])


def tageswerte(
    filter_id: int, region: str, aufloesung: str, tag: _dt.date
) -> list[tuple[int, float | None]]:
    """Die Messpunkte genau eines lokalen Kalendertags."""
    von, bis = tagesgrenzen(tag)
    block = max(b for b in wochenbloecke(filter_id, region, aufloesung) if b <= von)
    return [(t, v) for t, v in reihe(filter_id, region, aufloesung, block) if von <= t < bis]


def tagessumme_mwh(
    filter_id: int, region: str, aufloesung: str, tag: _dt.date
) -> tuple[float, int, int]:
    """Tagessumme in MWh, dazu Anzahl gelieferter und erwarteter Punkte.

    Der Aufrufer prueft die Vollstaendigkeit selbst -- diese Funktion
    verschweigt eine Luecke nicht durch stilles Aufsummieren.
    """
    punkte = tageswerte(filter_id, region, aufloesung, tag)
    werte = [v for _, v in punkte if v is not None]
    return sum(werte), len(werte), erwartete_punkte(tag, aufloesung)


def kraftwerke() -> dict:
    """Kraftwerks-Stammdaten mit Koordinaten.

    ACHTUNG: Dieser Endpunkt steht in KEINER veroeffentlichten Dokumentation.
    Er wurde aus dem SMARD-Frontend-Bundle rekonstruiert und kann sich ohne
    Ankuendigung aendern. scripts/validate.py hat dafuer einen Negativtest.
    Beleg: docs/beleg-kraftwerksdaten.md
    """
    return _hole("/power_plant_data/power_plant_metadata.json")
