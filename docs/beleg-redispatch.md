# Beleg: Zugang zur netztransparenz-API (Redispatch)

Stand: 31.08.2026. Zuständige Skills: `datenquellen-strom`, `actions-workflows`.

## Was belegt ist

Am 31.08.2026 **ohne Zugangsdaten** durch Abruf geprüft:

```
POST https://identity.netztransparenz.de/users/connect/token
     grant_type=client_credentials
  -> {"error":"invalid_client"}          echter OAuth-Endpunkt

GET  https://ds.netztransparenz.de/api/v1/data/redispatch
  -> HTTP 401                            Bearer-Token nötig
```

Also **OAuth 2.0 mit Client Credentials**, Token als `Authorization: Bearer` im
Kopf. Das ist keine Vermutung, das sind die Antworten der Gegenstelle.

**Noch nicht belegt:** die genauen Pfade der Datenreihen. Die Pfadliste steht im
Swagger-Bereich des Portals hinter der Anmeldung; die frei zugänglichen
PDF-Dokumente enthalten nur das Inhaltsverzeichnis der Datenkategorien, keine
Endpunkte. `scripts/nt-check.py` probiert eine Kandidatenliste durch und meldet,
welche antworten. Sobald der richtige Pfad bekannt ist, wird er als **benannte
Konstante** festgeschrieben — nie als geratene Zeichenkette im Abrufskript.

## Anleitung: Zugang einrichten

1. **Registrieren** auf <https://api-portal.netztransparenz.de/>.
   Kostenlos. Das Portal ist eine Blazor-Anwendung, es braucht also einen
   Browser — mit `curl` geht das nicht.
2. Nach der Anmeldung im Portal einen **API-Zugang anlegen**. Dabei entstehen
   eine **Client-ID** und ein **Client-Secret**. Das Secret wird in aller Regel
   nur einmal angezeigt.
3. **Lokal hinterlegen:** im Wurzelverzeichnis eine Datei `.env` anlegen (die
   Vorlage `.env.beispiel` liegt daneben):

   ```
   NT_CLIENT_ID=...
   NT_CLIENT_SECRET=...
   ```

   `.env` steht in `.gitignore` (Zeile 151) und bleibt dort. `scripts/validate.py`
   prüft, dass sie weder eingecheckt noch aus der Ignorierliste genommen wird.
4. **Prüfen:**

   ```
   python scripts/nt-check.py
   ```

   Das Skript holt ein Token, sagt ob der Zugang steht, probiert die
   Kandidatenpfade durch und zeigt vom ersten Treffer drei Zeilen. Es gibt die
   Zugangsdaten **nie** aus, auch nicht in Fehlermeldungen.
5. **Für die Automatik** (erst, wenn Schritt 4 durchläuft): dieselben zwei Werte
   als **GitHub Actions Secrets** hinterlegen, unter
   *Settings → Secrets and variables → Actions → New repository secret*.
   Namen genau `NT_CLIENT_ID` und `NT_CLIENT_SECRET`.

## Regeln, die dabei gelten

- **Ich gebe keine Zugangsdaten ein und lege keine Konten an.** Schritt 1 und 2
  macht Immo, Schritt 3 auch. Ab Schritt 4 übernehme ich.
- Ein einmal gepushtes Geheimnis steht auch nach dem Löschen noch in der
  History und muss **neu erzeugt** werden. Deshalb vor jedem Commit prüfen, dass
  kein Schlüssel im Diff steht.
- `.env.beispiel` ist die Vorlage und bleibt **leer**.

## Was danach kommt

Redispatch ist die *gemessene* Antwort auf die Frage nach dem Nord-Süd-Engpass:
wo wurde abgeregelt, wo hochgefahren, wie viel, von welchem Netzbetreiber
angefordert. Das ist etwas anderes als ein Lastfluss auf einer Leitung — den
gibt es weiterhin nicht — aber es ist der bislang beste öffentlich belegbare
Hinweis darauf, wo das Netz an seine Grenze kommt.

Auf der Seite bekäme es eine eigene Kachel und eine eigene Ebene auf der Karte.
Vorher gilt wie bei jeder neuen Reihe die Pflichtliste aus
`datenquellen-strom`: Rohabruf zeigen, Felder erklären, Einheit aus den Daten
nachweisen, Zeitzone prüfen, Nachmeldeverhalten notieren, Lizenz und
Namensnennung klären. **Die Lizenz der netztransparenz-Daten ist noch nicht
geprüft** — sie ist nicht automatisch CC BY 4.0 wie bei SMARD.
