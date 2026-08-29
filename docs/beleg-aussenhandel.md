# Beleg: Außenhandels-Filter-IDs bei SMARD

Stand: 30.08.2026. Zuständiger Skill: `datenquellen-strom`.

## Ausgangslage

Die SMARD-Filter-IDs für Erzeugung und Last sind in `bundesAPI/smard-api`
dokumentiert. Für den **Außenhandel je Nachbarland gibt es keine
veröffentlichte Liste** — weder bei SMARD selbst noch in der bundesAPI-Doku,
noch in einem der auffindbaren Community-Projekte.

Die Reihen existieren aber. Die Übersetzungsdatei des SMARD-Frontends
(`/app/assets/translations/lang-de.json`, 8.134 Einträge) führt sie namentlich:

```
MM-Name.Physikalischer Import          MM-Bausteine.Frankreich (Import)
MM-Name.Physikalischer Export          MM-Bausteine.Frankreich (Export)
MM-Name.Physikalischer Nettoexport     MM-Bausteine.Polen (Import)
```

Und die Beschreibung nennt die Eigenschaften:

> **Physikalischer Stromfluss** — Gemessene tatsächliche Importe und Exporte
> [MWh] von bzw. an die angrenzenden Länder des Verbundnetzes sowie der
> tatsächliche Nettoexport [MWh] (Import-Export-Saldo) – Datenlieferung in
> 1-h-Auflösung und sobald wie möglich aber spätestens eine Stunde nach der
> Einsatzzeit. [Quelle: ENTSO-E]

Die Zuordnung Name → Filter-ID steht in keiner der Dateien, die das Frontend
lädt. Sie musste empirisch bestimmt werden.

## Vorgehen

### 1. Welche IDs existieren überhaupt?

Scan des ID-Raums 1 bis 5200 gegen den Index-Endpunkt, Region `DE`,
Auflösung `hour`, mit HTTP-HEAD:

```
https://www.smard.de/app/chart_data/{id}/DE/index_hour.json
```

Vorher geprüft, dass HEAD dieselben Statuscodes liefert wie GET (410 → 200,
4169 → 200, 1042 → 404, 99999 → 404).

**Ergebnis: 407 IDs antworten mit HTTP 200.**

### 2. Referenz beschaffen

Energy-Charts liefert die grenzüberschreitenden **physikalischen** Flüsse je
Nachbarland über den Endpunkt `cbpf`:

```
https://api.energy-charts.info/cbpf?country=de&start=2026-08-19&end=2026-08-19
```

Einheit dort **GW**, viertelstündlich, Vorzeichen positiv = Import nach
Deutschland. Die Einheit wurde geprüft, nicht angenommen: die Tagessumme der
Reihe `sum` ergibt +36,4 GWh und stimmt mit dem unabhängig gerechneten
Außensaldo überein. Ein erster Anlauf mit der Annahme „MW“ lag um Faktor 1000
daneben und wurde verworfen.

### 3. Zuordnung über Wertevergleich

Für jede der 407 IDs wurden die Stundenwerte einer vollen Woche geholt und
gesucht:

- eine Reihe `A` mit `A(h) = −netto(h)` → das ist die Nettoexport-Reihe
- ein Paar `(I, E)`, beide durchgehend `≥ 0`, mit `I(h) − E(h) = netto(h)`
  für alle 168 Stunden → Import- und Exportreihe

Über 24 Stunden war das nicht eindeutig: Reihen, die an dem Tag durchgehend
Null sind, passen scheinbar auf alles. Über 168 Stunden bleibt **je Land genau
ein Paar** übrig.

## Ergebnis

Region `DE`, Auflösung `hour`, Einheit **MWh je Stunde**. Import- und
Exportreihen sind vorzeichenlos positiv; die Nettoexport-Reihe ist positiv bei
Export aus Deutschland und negativ bei Import.

| Nachbarland | Import | Export | Nettoexport |
|---|---:|---:|---:|
| Belgien | 4993 | 4992 | 4995 |
| Dänemark | 4782 | 4736 | 4927 |
| Frankreich | 4783 | 4737 | 4928 |
| Luxemburg | 4786 | 4738 | 4929 |
| Niederlande | 4787 | 4739 | 4930 |
| Norwegen | 4989 | 4988 | 4991 |
| Österreich | 4788 | 4740 | 4931 |
| Polen | 4789 | 4741 | 4932 |
| Schweden | 4790 | 4742 | 4933 |
| Schweiz | 4791 | 4743 | 4934 |
| Tschechien | 4792 | 4744 | 4935 |

## Gegenprobe an einer zweiten Woche

Die Zuordnung wurde an einer **unabhängigen zweiten Woche** (08.–14.06.2026,
Wochenblock `1780869600000`) noch einmal vollständig nachgerechnet:

```
Land               Imp   Exp NettoExp  max|I-E-Netto|  max|NettoExp+Netto|  Import GWh  Export GWh
Austria           4788  4740     4931           0.420                0.420       129.3       131.4
Belgium           4993  4992     4995           0.470                0.470        62.5        51.5
Czech Republic    4792  4744     4935           0.410                0.410        79.6       134.9
Denmark           4782  4736     4927           0.430                0.430       103.0       105.6
France            4783  4737     4928           0.380                0.380       380.1        14.5
Luxembourg        4786  4738     4929           0.380                0.370         0.1        38.5
Netherlands       4787  4739     4930           0.400                0.400        92.3       227.4
Norway            4989  4988     4991           0.390                0.390       112.9        56.1
Poland            4789  4741     4932           0.380                0.380        21.4       202.3
Sweden            4790  4742     4933           0.460                0.460        21.6        20.9
Switzerland       4791  4743     4934           0.450                0.450       115.4        81.8
```

Maximale Abweichung **0,47 MWh** über 168 Stunden × 11 Länder. Das entspricht
der Rundung von Energy-Charts (zwei Nachkommastellen in GW = 10 MW, über eine
Stunde gemittelt) und keiner inhaltlichen Differenz.

Schweden war in der ersten Woche durchgehend Null und ließ sich dort nicht
zuordnen. In der zweiten Woche trägt die Baltic-Cable-Verbindung 21,6 GWh
Import und 20,9 GWh Export — damit ist auch Schweden belegt und nicht geraten.

Vorzeichenprüfung: Import- und Exportreihen haben in beiden Wochen **keinen
einzigen negativen Wert**. Die Nettoexport-Reihen haben negative Werte, wie es
sein muss.

## Einschränkungen — gehören ins Methodik-PDF

1. **Die IDs sind nicht dokumentiert.** Sie sind belegt hergeleitet, aber
   SMARD sagt nirgends zu, dass sie stabil bleiben. Ändern sie sich, liefert
   der Abruf entweder HTTP 404 oder — schlimmer — stillschweigend die falsche
   Reihe. Das Abrufskript muss die Zuordnung deshalb regelmäßig gegen
   Energy-Charts nachprüfen, nicht nur einmal.
2. **Der Abgleich ist eine Konsistenzprüfung, keine Gegenprobe.** SMARD und
   Energy-Charts gehen beide auf ENTSO-E zurück. Der Vergleich belegt, dass
   die richtige Reihe unter der richtigen ID liegt — nicht, dass die Messung
   stimmt.
3. **Auflösung 1 h**, während Erzeugung und Last viertelstündlich vorliegen.
   In der Tagesbilanz bleibt dadurch ein kleiner Rest, der auf der Seite als
   Kennzahl „Bilanzrest“ ausgewiesen wird statt weggerechnet zu werden.
4. **Kommerzieller Außenhandel** (geplante statt gemessene Mengen) wurde
   bewusst nicht zugeordnet. Für dieses Projekt gilt „messen statt
   modellieren“, und der kommerzielle Handel ist eine Nominierung, keine
   Messung.

## Prüfbefehl

```
python scripts/fetch-tagesdaten.py 2026-08-19
python scripts/validate.py
```
