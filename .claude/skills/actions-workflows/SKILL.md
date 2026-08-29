---
name: actions-workflows
description: GitHub Actions und Pages-Deploy fuer dieses Repository — getrennte Workflows je Quelle, Push-Wiederholung ohne force, Trigger-Verhalten des GITHUB_TOKEN, paths-Filter, Validierungsskript als Tuersteher. Nutzen beim Anlegen oder Aendern von Workflows, Abrufjobs oder der Deploy-Kette.
---

# Workflows und Deploy

Getrennte Workflows nach Zustaendigkeit, damit der Ausfall einer Quelle nicht
die anderen mitreisst. Ein Workflow je Datenquelle, ein eigener fuer den Deploy.

## Push-Verhalten

- Bei "fetch first": Branch nachholen, rebasen, erneut versuchen, bis zu
  dreimal. **Niemals `--force`.** Bei echtem Konflikt sichtbar abbrechen, nicht
  stillschweigend ueberschreiben.

## Trigger

- Pushes mit dem Standard-`GITHUB_TOKEN` loesen **keine** weiteren Workflows
  aus. Ein Workflow, der Daten committet, muss den Pages-Deploy also selbst
  anstossen — inline oder ueber einen `workflow_run`-Trigger im Deploy-Workflow.
- Der `paths`-Filter des Deploy-Workflows muss **jede** Datei nennen, die auf
  der Seite landet. Fehlt eine, deployt ihre Aenderung stillschweigend nicht.
  Bei jeder neuen Datei den Filter mitpflegen.

## Actions-Versionen

Actions auf aktuellem Stand halten; vor dem Festschreiben einer Version die
aktuelle Fassung pruefen, nicht aus dem Gedaechtnis eintragen. Veraltete
Node-Laufzeiten werden von GitHub zuerst erzwungen und spaeter abgeschaltet.

## Validierungsskript als Tuersteher

Laeuft vor dem Deploy und prueft, dass alle Dateien existieren und die
`index.html` die erwarteten Bausteine einbindet. Es waechst mit: jede neue Datei
und jede belegte Sachaussage kommt hinein. Es hat eigene Negativtests — siehe
Skill `pruefpflichten`.

## Forks und Ruhezeiten

- In Forks sind geplante Workflows standardmaessig **aus** und muessen von Hand
  aktiviert werden.
- In oeffentlichen Repositories schaltet GitHub geplante Workflows nach 60 Tagen
  ohne Aktivitaet ab. PowerFlow ist public — das trifft zu. Bei laengerer Pause
  pruefen, ob die Abrufjobs noch laufen.

## Secrets

Kein Token, kein Schluessel im Repository. Falls spaeter ein ENTSO-E-Zugang
dazukommt: GitHub Actions Secret, lokal `.env`, und `.env` bleibt gitignored.
Vor jedem Commit pruefen, dass kein Schluessel im Diff steht — einmal gepusht
ist er auch nach dem Loeschen noch in der History und muss neu erzeugt werden.
