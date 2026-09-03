# Was die ENTSO-E Transparency Platform anbietet — und was davon wir haben

Erhoben am 03.09.2026 aus dem Hilfebereich der Plattform (272 Artikel, davon
53 mit einem Artikelverweis der Verordnung 543/2013 im Titel) und aus der
*List of Data available for free re-use*, Fassung 18.10.2023.

## Die drei wichtigsten Befunde

**1. Die Seite steht auf fünf Reihen. Vier davon sind NICHT auf der
Freigabeliste der Plattform.** Netzlast (6.1.A), Großhandelspreis (12.1.D),
Erzeugung nach Energieträger (16.1.B) und installierte Leistung je Anlage
(14.1.B) stehen dort nicht — frei weiterverwendbar sind nach Klausel 2.5 nur
die 35 Datenpunkte der Liste, und Erzeugung, Last und Preise gehören nicht
dazu.

Für PowerFlow ist das folgenlos, **weil wir sie nicht von der Plattform holen,
sondern von SMARD**: die Bundesnetzagentur veröffentlicht dieselben Größen als
eigene Veröffentlichung unter CC BY 4.0. Hätten wir sie direkt bei ENTSO-E
geholt, wäre die Lizenzfrage offen.

**2. Genau zwei unserer Reihen sind auch bei ENTSO-E frei:** die physischen
Flüsse (12.1.G) und Redispatch (13.1.A). Beim Redispatch trägt genau das die
Lizenzkette — siehe `docs/beleg-redispatch.md`.

**3. Der lohnendste noch nicht genutzte Datenpunkt ist 13.1.C**, „Costs of
congestion management": er steht auf der Freigabeliste und beantwortet die
Frage, die bei Redispatch als erste kommt — **was es kostet**. Bisher zeigt die
Seite nur die Menge.

## Die vollständige Liste

`ja` heißt: die Größe steht auf der Seite. Ob sie von der Plattform kommt, ist
eine andere Frage — bei allem außer Redispatch kommt sie von SMARD.

| Artikel | Datenpunkt | haben wir? | woher / Anmerkung | frei nutzbar |
|---|---|---|---|---|
| `4.3` | BalancingBorderCapacityLimitations_IFs | — |  | nein |
| `4.5` | PermanentAllocationLimitations_IFs | — |  | nein |
| `6.1.A` | ActualTotalLoad | **ja** | Netzlast, taeglich und stuendlich, seit 2015 -- ueber SMARD | nein |
| `6.1.B` | DayAheadTotalLoadForecast | — |  | CC BY 4.0 |
| `6.1.C` | TotalLoadForecast | — |  | CC BY 4.0 |
| `6.1.D` | Month-ahead Total Load Forecast per Week | — |  | CC BY 4.0 |
| `6.1.E` | Year-ahead Total Load Forecast per Week | — |  | CC BY 4.0 |
| `7.1.A` | UnavailabilityOfConsumptionUnits | — |  | nein |
| `7.2` | Fall-backs | — |  | nein |
| `8.1` | YearAheadForecastMargin | — |  | nein |
| `9.1` | ExpansionAndDismantlingProjects | — |  | CC BY 4.0 |
| `9.8` | ChangesToBidAvailability_IFs_mFRR9.9_aFRR9.6 | — |  | nein |
| `10.1.A` | UnavailabilityInTheTransmissionGrid | — |  | CC BY 4.0 |
| `10.1.C` | UnavailabilityOfOffshoreGrid | — |  | nein |
| `11.1` | Flow-based Allocations | — |  | nein |
| `11.1.A` | Estimated and offered cross-zonal capacity | — |  | CC BY 4.0 |
| `11.1.B` | FlowBasedCapacityAllocation | — |  | CC BY 4.0 |
| `11.3` | CrossBorderCapacityForDcLinksIntradayTransferLimits | — |  | nein |
| `11.4` | Yearly Report About Critial Network Elements Limiting Offered Capacities | — |  | CC BY 4.0 |
| `12.1.A` | AuctionRevenue | — |  | CC BY 4.0 |
| `12.1.B` | TotalCapacityNominated | — |  | CC BY 4.0 |
| `12.1.C` | TotalCapacityAlreadyAllocated | — |  | CC BY 4.0 |
| `12.1.D` | EnergyPrices | **ja** | Grosshandelspreis Day-Ahead, stuendlich -- ueber SMARD | nein |
| `12.1.E` | ImplicitAllocationsNetPositions | — |  | nein |
| `12.1.F` | CommercialSchedules | — |  | nein |
| `12.1.G` | PhysicalFlows | **ja** | Aussenhandel je Nachbarland, Ein- und Ausfuhr getrennt -- ueber SMARD | CC BY 4.0 |
| `12.1.H` | TransferCapacitiesAllocatedWithThirdCountries | — |  | nein |
| `12.3.A` | CurrentBalancingState | — |  | CC BY 4.0 |
| `12.3.B` | BalancingEnergyBids | — |  | nein |
| `12.3.E` | AggregatedBalancingEnergyBids | — |  | CC BY 4.0 |
| `12.3.F` | ProcuredBalancingCapacity | — |  | CC BY 4.0 |
| `12.3.G` | Terms and Conditions | — |  | nein |
| `12.3.H` | CrossZonalBalancingCapacity | — |  | nein |
| `13.1.A` | Redispatching | **ja** | Redispatch, Tagesaggregate + Stundenprofil -- ueber netztransparenz.de | CC BY 4.0 |
| `13.1.B` | Countertrading | teilweise | Countertrade steckt als Grund in den Redispatch-Saetzen, nicht als eigene Reihe | CC BY 4.0 |
| `13.1.C` | CostsOfCongestionManagement | — |  | CC BY 4.0 |
| `14.1.A` | InstalledGenerationCapacityAggregated | — |  | nein |
| `14.1.B` | Installed Capacity Per Production Unit | teilweise | 596 Kraftwerksstandorte mit Leistung und Koordinate (SMARD) + Windparks (MaStR) | nein |
| `14.1.C` | DayAheadAggregatedGeneration | — |  | nein |
| `14.1.D` | GenerationForecastsForWindAndSolar | — |  | nein |
| `15.1.A` | UnavailabilityOfProductionAndGenerationUnits | — |  | nein |
| `16.1.A` | Actual Generation per Generation Unit | — |  | nein |
| `16.1.B` | AggregatedGenerationPerType | **ja** | Erzeugung nach zwoelf Energietraegern, taeglich und stuendlich -- ueber SMARD | nein |
| `16.1.D` | AggregatedFillingRateOfWaterReservoirsAndHydroStoragePlants | — |  | nein |
| `17.1.A` | Rules on Balancing | — |  | nein |
| `17.1.B` | Capacity: Volumes of Contracted Balancing Reserves | — |  | CC BY 4.0 |
| `17.1.C` | Capacity: Price of Reserved Balancing Reserves | — |  | CC BY 4.0 |
| `17.1.D` | Accepted Offers and Activated Balancing Reserves | — |  | CC BY 4.0 |
| `17.1.F` | PricesOfActivatedBalancingEnergy | — |  | CC BY 4.0 |
| `17.1.G` | ImbalancePrices | — |  | CC BY 4.0 |
| `17.1.H` | TotalImbalanceVolumes | — |  | CC BY 4.0 |
| `17.1.I` | FinancialExpensesAndIncomeForBalancing | — |  | CC BY 4.0 |
| `17.1.J` | Cross-Border Balancing | — |  | CC BY 4.0 |

## Was „nicht frei" bedeutet — und was nicht

Es heißt: der Datenpunkt steht nicht auf der Liste nach Klausel 2.5 der Terms
of Use. Eine Weiterverwendung setzt dann die Zustimmung des jeweiligen Primary
Owner of Data voraus. Es heißt **nicht**, dass die Daten geheim wären oder dass
man sie nicht ansehen dürfte — und es heißt vor allem nicht, dass dieselbe
Größe nicht anderswo frei verfügbar wäre. Genau das ist bei Netzlast,
Erzeugung und Preisen der Fall: SMARD stellt sie unter CC BY 4.0.

## Lohnende Kandidaten für dieses Projekt

Bewertet nach dem, was die Seite heute nicht beantworten kann:

| Datenpunkt | frei? | was es brächte |
|---|---|---|
| `13.1.C` Kosten des Engpassmanagements | **CC BY 4.0** | Was Redispatch kostet. Die Seite zeigt bisher nur die Menge. netztransparenz.de führt dieselbe Größe. |
| `6.1.B` Day-ahead-Lastprognose | **CC BY 4.0** | Prognose gegen Messung — wie gut wird die Last vorhergesagt. |
| `17.1.G` Ausgleichsenergiepreise | **CC BY 4.0** | Der Preis der Abweichung, das Gegenstück zum Day-Ahead-Preis. |
| `15.1.A` Nichtverfügbarkeit von Kraftwerken | nein | Erklärte Ausfälle. Würde Einbrüche in der Erzeugung erklären. |
| `16.1.A` Erzeugung je Anlage | nein | Erzeugung auf der Karte je Kraftwerk statt nur Standort. Der größte Sprung für die Karte — und lizenzrechtlich der schwierigste. |
| `12.1.F` Kommerzielle Fahrpläne | nein | Gegen 12.1.G gehalten: der Unterschied zwischen gehandeltem und tatsächlich fließendem Strom (Ringflüsse). |

Nichts davon ist beschlossen. Die Tabelle steht hier, damit die Auswahl beim
nächsten Mal nicht aus dem Gedächtnis getroffen wird.
