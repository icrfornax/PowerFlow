"""Prueft den Zugang zur netztransparenz-API und sucht die Redispatch-Reihen.

Aufruf:  python scripts/nt-check.py

Erst laufen lassen, wenn NT_CLIENT_ID und NT_CLIENT_SECRET hinterlegt sind --
lokal in `.env`, in GitHub Actions als Secrets. Das Skript gibt die
Zugangsdaten NIE aus.

Es tut drei Dinge:
  1. holt ein Token und sagt, ob der Zugang steht
  2. probiert eine Liste plausibler Pfade durch und meldet, welche antworten
  3. zeigt vom ersten Treffer die Kopfzeile und zwei Datenzeilen

Schritt 2 ist bewusst ein Suchlauf: die Pfadliste der API steht nur im
Swagger-Bereich des Portals hinter der Anmeldung. Sobald wir wissen, welcher
Pfad stimmt, wird er als benannte Konstante festgeschrieben -- nie als geratene
Zeichenkette im Abrufskript.
"""

from __future__ import annotations

import sys
import urllib.error

import netztransparenz as nt

# Kandidaten. Reihenfolge nach Wahrscheinlichkeit, nicht nach Hoffnung.
KANDIDATEN = [
    "data/redispatch",
    "data/Redispatch",
    "data/redispatchmassnahmen",
    "data/NetzRegelverbund/Redispatch",
    "data/Redispatch/2026-08-01/2026-08-07",
    "data/redispatch/2026-08-01/2026-08-07",
    "data/nrvsaldo",
    "data/NrvSaldo",
    "data/regelleistung",
    "data/AusgeglicheneAbweichung",
    "data/health",
    "data",
]


def main() -> int:
    print("1. Token holen")
    try:
        t = nt.token()
    except nt.KeinZugang as fehler:
        print("   FEHLT:", fehler)
        return 1
    except urllib.error.URLError as fehler:
        print("   FEHLT: Verbindung zum Token-Endpunkt gescheitert:", fehler)
        return 1
    print(f"   ok. Token erhalten, {len(t)} Zeichen. (Wird nicht ausgegeben.)")
    print()

    print("2. Pfade durchprobieren")
    treffer = []
    for pfad in KANDIDATEN:
        try:
            antwort = nt.hole(pfad, roh=True)
        except urllib.error.HTTPError as fehler:
            print(f"   {fehler.code:>3}  {pfad}")
            continue
        except urllib.error.URLError as fehler:
            print(f"   ---  {pfad}  ({fehler})")
            continue
        print(f"   200  {pfad}   {len(antwort):,} Zeichen")
        treffer.append((pfad, antwort))
    print()

    if not treffer:
        print("Kein Pfad hat geantwortet. Der Zugang steht, aber die Pfadliste stimmt")
        print("noch nicht. Im Portal unter https://api-portal.netztransparenz.de/")
        print("den Swagger-Bereich oeffnen und die tatsaechlichen Pfade ablesen.")
        return 1

    pfad, antwort = treffer[0]
    print(f"3. Erste Zeilen von {pfad}")
    for zeile in antwort.splitlines()[:3]:
        print("   ", zeile[:160])
    print()
    print(f"{len(treffer)} von {len(KANDIDATEN)} Pfaden haben geantwortet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
