# Der Bilanzrest — woher die „nicht erklärte Lücke" kommt

Untersucht am 03.09.2026, nachdem im Verlaufsdiagramm sichtbar geworden war,
dass ein Teil der Unterdeckung auch durch die gemessene Einfuhr nicht gedeckt
wird. Die Frage war: **Wo kommt das her? Ist das Redispatch?**

Kurze Antwort: **Es ist nicht Redispatch.** Es ist auch keine verschwundene
Energie. Es ist ein Unterschied zwischen zwei Reihen, die nicht dasselbe
messen — und er hat eine messbare Struktur.

## Die Größe

Gerechnet wird `Erzeugung + Einfuhr − Ausfuhr − Netzlast`, je Stunde bzw. je
Tag, alles aus den eigenen Dateien.

| Jahr | Rest in % der Netzlast |
|---|---|
| 2015 | −8,84 % |
| 2016 | −8,43 % |
| 2017 | −8,98 % |
| **2018** | **−3,13 %** |
| 2019 | −1,91 % |
| 2020 | −0,18 % |
| 2021 | −2,63 % |
| 2022 | −2,11 % |
| 2023 | +0,88 % |
| 2024 | −0,58 % |
| 2025 | −2,08 % |
| 2026 (bis 31.08.) | −1,83 % |

Über alle 4.260 Tage: −3,45 % der Netzlast, in Summe **−196 TWh bei 5.691 TWh**.

Das Vorzeichen ist wichtig: **negativ heißt, die veröffentlichte Erzeugung plus
Einfuhr ist KLEINER als die Netzlast.** Es fehlt Erzeugung, nicht Verbrauch.

## Befund 1: Der Bruch 2018 ist Erdgas

Zwischen 2017 und 2018 springt der Rest von −8,98 % auf −3,13 %. Im selben
Schritt springt genau eine Reihe:

| Reihe | 2015 | 2016 | 2017 | **2018** | 2019 | 2020 |
|---|---|---|---|---|---|---|
| **Erdgas** | 15,2 | 22,9 | 25,6 | **42,9** | 54,6 | 67,6 |
| Steinkohle | 81,1 | 80,9 | 66,0 | 71,5 | 47,8 | 34,9 |
| Braunkohle | 133,8 | 130,4 | 129,3 | 128,3 | 102,7 | 83,4 |
| Netzlast | 502,0 | 503,9 | 506,8 | 509,2 | 497,4 | 485,4 |

Alle Angaben in TWh. **+17,3 TWh Erdgas von 2017 auf 2018 sind 3,4 % der
Netzlast** — und der Rest verbessert sich um 5,9 Prozentpunkte. Die
Größenordnung passt.

Die Reihe „Erdgas" verdreifacht sich zwischen 2015 und 2020, während Kohle
zurückgeht. Ein realer Zubau in dieser Höhe hat nicht stattgefunden; was sich
geändert hat, ist die **Erfassung**. Damit ist die frühere Angabe auf der Seite
— „die Ursache der frühen Lücke ist nicht geklärt" — beantwortet.

## Befund 2: Redispatch erklärt nichts davon

Das war die Ausgangsfrage. Gemessen über **2.050 Tage ab 2021**, für die sowohl
eine vollständige Bilanz als auch Redispatch-Daten vorliegen:

- **Korrelation zwischen Bilanzrest (%) und Redispatch-Arbeit: r = −0,048.**
  Das ist kein Zusammenhang.
- Das Fünftel der Tage mit dem **wenigsten** Redispatch (im Mittel 5.465 MWh):
  Bilanzrest **−1,26 %**.
- Das Fünftel mit dem **meisten** Redispatch (im Mittel 163.282 MWh, also das
  Dreißigfache): Bilanzrest **−1,64 %**.

0,38 Prozentpunkte Unterschied bei dreißigfacher Redispatch-Menge. Es gibt
keinen Hebel.

Das passt auch zur Sache: Redispatch **verschiebt** Erzeugung zwischen Anlagen
— ein Kraftwerk fährt hoch, ein anderes herunter. Beide Seiten stehen bereits
in denselben Erzeugungsreihen, die hier summiert werden. Redispatch kann die
Bilanz gar nicht bewegen.

## Befund 3: Der Rest hat einen Tagesgang — und er ist der Spiegel der Residuallast

Median des Rests je Stunde des Tages, 17.544 Stunden aus 2024 und 2025:

| Stunde | Rest | | Stunde | Rest |
|---|---|---|---|---|
| 03:00 | **+0,85 %** | | 14:00 | **+3,11 %** |
| 07:00 | −3,59 % | | 18:00 | −3,78 % |
| 08:00 | −3,63 % | | **20:00** | **−4,28 %** |
| 12:00 | +2,12 % | | 23:00 | −3,13 % |

Und je Monat: **Dezember −4,85 %**, Januar −3,08 %, **Juni −0,11 %**.

Mittags positiv, abends und im Winter am stärksten negativ. Das ist der
Tagesgang der **Residuallast** — also des Teils der Last, der nicht von Wind
und Photovoltaik gedeckt wird. Die Korrelationen bestätigen es:

| Größe | Korrelation mit dem Rest (MWh) |
|---|---|
| **Residuallast (Last − Wind − PV)** | **r = −0,668** |
| konventionelle Erzeugung | r = −0,600 |
| Netzlast | r = −0,357 |
| Redispatch-Arbeit | r = −0,048 |

Eine Ausgleichsrechnung über dieselben Stunden:

```
Rest ≈ −13,55 % × Netzlast  +14,81 % × Photovoltaik  +4,78 % × Wind  +4.590 MWh
```

Sie erklärt **60 % der Streuung**. Die einzelnen Koeffizienten sind wegen der
starken Kopplung der Größen nicht einzeln deutbar — die Richtung ist es: je
mehr die Last von steuerbarer Erzeugung getragen werden muss, desto größer die
Lücke.

## Befund 4: Was es NICHT ist — zwei eigene Sätze werden zurückgenommen

Auf der Seite stand bis zum 03.09.2026, in der Lücke steckten unter anderem
**Netzverluste** und der **Bezug der Pumpspeicher**. Beides trägt nicht:

- **Netzverluste haben das falsche Vorzeichen.** Verluste bedeuten, dass mehr
  erzeugt als verbraucht werden muss — sie machen den Rest **positiver**. Der
  gemessene Rest ist negativ. Verluste können ihn nicht erklären, sie
  vergrößern ihn sogar rechnerisch.
- **Der Pumpspeicherbezug steckt bereits in der Netzlast.** Zieht man ihn ein
  zweites Mal ab, wird der Rest von −1,29 % auf −3,81 % schlechter (gemessen
  über 1.221 vollständige Tage). Er ist also enthalten und keine Erklärung.

Beide Sätze sind auf der Seite berichtigt.

## Befund 5: Netzlast und Erzeugung sind innerhalb der Quelle konsistent

Gegenprobe: SMARD veröffentlicht die **Residuallast** als eigene Reihe. Rechnet
man sie selbst als `Netzlast − Wind Onshore − Wind Offshore − Photovoltaik`,
ergibt sich in **allen zwölf Jahren eine Abweichung von exakt 0 MWh im Median**.

Die Quelle rechnet also mit denselben Zahlen, die sie veröffentlicht. Der Rest
ist demnach kein Rechenfehler in einer der Reihen, sondern liegt darin, was die
Reihen **erfassen**.

## Was daraus folgt — und was offen bleibt

**Gemessen** ist: der Rest ist systematisch, negativ, folgt der Residuallast,
war vor 2018 dreimal so groß, und hat mit Redispatch nichts zu tun.

**Geschlossen, nicht gemessen** ist die Ursache: die Netzlast ist der Verbrauch
im Netz der allgemeinen Versorgung, die Erzeugungsreihen sind eine Aufstellung
je Energieträger. Beide werden unterschiedlich erhoben, und die
Erzeugungsseite erfasst offenbar nicht jede Anlage, die in dieses Netz
einspeist — kleine und industrielle Anlagen fehlen eher als große. Genau das
zeigt der Erdgas-Sprung von 2018, und genau dazu passt, dass die Lücke dann am
größten ist, wenn steuerbare Erzeugung die Last trägt.

Was in dieser Untersuchung **nicht** geklärt werden konnte: welche Anlagenarten
konkret fehlen und ab welcher Größe. Das steht so in den offenen Punkten. Die
Zahlen werden nicht angeglichen — der Rest bleibt als eigene Kachel sichtbar.
