# Browsertest

Stand: 31.08.2026. Zuständiger Skill: `pruefpflichten`.

## Was er prüft

Die Pflichtliste aus `pruefpflichten`, bei jeder Änderung, automatisch:

- dunkles Schema, helles Schema, drei Breiten (1280, 768, **390 px**)
- **kein waagerechter Überlauf** — geprüft über `scrollWidth` gegen `innerWidth`,
  und bei einem Treffer werden die drei schuldigen Elemente benannt
- **keine Konsolenfehler**, keine unbehandelten Ausnahmen, keine Ladefehler
- **jeder Info-Knopf** öffnet sein Popover, schließt mit Escape, und **jedes
  Popover sagt, was Messung und was Annahme ist**
- **jedes Bedienelement**: Zeitraumfelder, alle Schnellwahl-Knöpfe, Schritt vor
  und zurück, Zurücksetzen, Fadenkreuz im Diagramm, Tabellenschalter, Karte
  zoomen und zurücksetzen, Kraftwerk und Kuppelstelle auswählen, Ebenenschalter
- der **CSV-Abzug** wird ausgelöst und seine Größe geprüft

Dazu Bildschirmfotos in `.browsertest/` — nicht eingecheckt, in der
GitHub-Action 14 Tage als Artefakt aufbewahrt.

## Warum keine zusätzliche Software nötig ist

Ich hatte diesen Test lange als „nicht möglich" ausgewiesen, weil kein
Playwright und kein Puppeteer installiert ist. **Das war zu kurz gedacht.**

- Chrome spricht von Haus aus das **DevTools-Protokoll**, sobald er mit
  `--remote-debugging-port` startet.
- **Node bringt seit Version 22 einen WebSocket-Client mit** (`globalThis.WebSocket`).

Damit reicht Bordmittel. `scripts/browsertest.mjs` startet einen eigenen Chrome
mit **wegwerfbarem Profil** in einem temporären Verzeichnis — eine laufende
Browsersitzung des Benutzers wird nicht angefasst — und steuert ihn über
`Target.attachToTarget`, `Runtime.evaluate`, `Emulation.setDeviceMetricsOverride`
und `Page.captureScreenshot`.

## Aufruf

```
python -m http.server 8080 --bind 127.0.0.1 &
node scripts/browsertest.mjs http://127.0.0.1:8080
```

Exit-Code 1, sobald eine Prüfung fehlschlägt. Im Workflow `pruefen.yml` läuft
er bei jeder Änderung mit; `scripts/validate.py` prüft, dass er dort
eingehängt bleibt.

## Was der erste Lauf gefunden hat

31 Prüfungen, davon eine rot — und die lag **an meinem Test, nicht an der
Seite**: ich hatte ein Datum mit einem Wahrheitswert verglichen. Behoben.

Beim Ansehen der Bildschirmfotos fielen drei Sachen auf, die keine Prüfung
gemeldet hätte:

1. Sechs Kennzahlen-Kacheln standen als **5 + 1** — die letzte allein in einer
   eigenen Reihe. Rasterbreite von 210 auf 260 px, jetzt 4 + 2.
2. Auf jeder Kachel stand „kein Regler — **gemessener Tageswert**". Seit der
   Zeitraum die freie Variable ist, war das falsch: bei sieben Tagen ist es
   kein Tageswert. Jetzt „gemessener Wert".
3. Die Pfeile an den Kuppelstellen schwebten **mitten im Land** und ließen sich
   als innerdeutsche Flüsse missverstehen — genau das, was sie ausdrücklich
   nicht sind. Anker von 0,42 auf 0,62 der Landeshalbbreite, jetzt an der
   Grenze. Der Auswahlring darum sah zudem aus wie ein Verbotsschild, weil der
   Pfeil ihn durchkreuzte; daraus ist eine weiche Scheibe dahinter geworden.

Das ist der Grund, warum der Skill „Render it and look at it" verlangt: der
Validierer prüft Farben und Zahlen, nicht die Anmutung.

## Grenzen

- Der Test läuft **headless**. Schriftglättung, echte Berührungsgesten und das
  Verhalten fremder Browser sind damit nicht geprüft.
- Er misst **keinen** waagerechten Überlauf innerhalb eigener Scrollcontainer —
  das ist Absicht, Tabellen und Karte dürfen dort rollen.
- Ein Mensch, der einmal draufschaut, bleibt trotzdem sinnvoll.
