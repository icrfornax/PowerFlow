PowerFlow

Statisches Daten-Dashboard zu Stromflüssen und -mengen im deutschen Stromnetz.

Status: in Arbeit. Die Leitfrage und die freie Variable sind noch nicht festgelegt, siehe CLAUDE.md. Es gibt noch keine veröffentlichte Seite.

Idee

Eine Tagesbilanz des deutschen Stromsystems: Zufluss aus Erzeugung und Import, Verbrauch, Abfluss durch Export. Jede angezeigte Zahl bringt ihre Herkunft mit — über einen Info-Knopf auf der Seite, über einen CSV-Export mit vollständigem Kommentarkopf und über ein Methodik-PDF, das sich bei jedem Bau neu aus den Daten im Repository rechnet.

Vorbild für Aufbau und Sorgfaltsniveau ist das „Flussbilanz-Labor" in icrfornax/de-gas-storage-tracker-bnetza.

Datenquellen

SMARD (Bundesnetzagentur) — Primärquelle für Last, Erzeugung nach Energieträger und Außenhandel. Die Daten stehen unter CC BY 4.0. Namensnennung: Bundesnetzagentur | SMARD.de. https://www.smard.de/

Energy-Charts (Fraunhofer ISE) — Zweitzugriff und Ausfallreserve, unter anderem für den grenzüberschreitenden Stromhandel. Zugriff ohne Registrierung und ohne Token, weitgehend CC BY 4.0; die Lizenz gilt je Endpunkt. https://api.energy-charts.info/

netztransparenz.de — Redispatch-Daten der vier deutschen Übertragungsnetzbetreiber. https://www.netztransparenz.de/

Zur Unabhängigkeit der Quellen

SMARD und Energy-Charts bestätigen einander nicht unabhängig: SMARD bezieht die Daten direkt von ENTSO-E, und Energy-Charts veröffentlicht die Daten mehrerer Gebotszonen unverändert von SMARD. Ein Abgleich zwischen beiden ist eine Konsistenzprüfung der Übertragungskette, keine Gegenprobe der Messung. Für eine echte Gegenprobe wird eine anders erhobene Jahressumme herangezogen.

Was dieses Projekt nicht zeigt

Flüsse auf einzelnen Hoch- und Höchstspannungsleitungen. Nach § 23c Abs. 2 EnWG werden grenzüberschreitende Lastflüsse nur zusammengefasst je Kuppelstelle veröffentlicht; Anlagen- und Standortdaten der Übertragungsnetzbetreiber sind vertraulich. Öffentlich verfügbare Darstellungen einzelner Leitungsauslastungen sind Modellrechnungen. Solche Werte werden hier nicht als Messung dargestellt.

Lizenz

Der Code steht unter der MIT-Lizenz (siehe LICENSE). Die Lizenz gilt für den Code, nicht für die Daten — für diese gelten die Bedingungen der jeweiligen Quelle, siehe oben.