---
title: "Leistungen und Zeiteinträge erfassen"
description: >-
  Zeiteinträge je Kunde mit Stundensatz erfassen, von Hand oder aus einem Zeiterfassungsprogramm wie Kimai über
  die REST-API, als Grundlage für die Rechnung.
---

# Leistungen

Unter **Leistungen** erfasst du abrechenbare Zeit je Kunde: Arbeitstag, Dauer, Tätigkeit und Stundensatz. Wer nach Stunden abrechnet, hat die Zeiten dort, wo auch die Rechnung entsteht, und muss sie nicht aus einem anderen Programm abtippen. Eine Zeiterfassung wie Kimai oder Toggl schickt ihre Einträge über die [REST-API](api.md#leistungen-und-zeiterfassung) an Haben.

Eine Buchung entsteht aus einem Eintrag nicht: Er ist die Grundlage, aus der die Rechnung wird ([Abrechnen](#abrechnen)). Gebucht wird wie immer erst, wenn du die Rechnung festschreibst.

## Einträge anlegen

**Neuer Eintrag** öffnet das Formular:

| Feld | Bedeutung |
| --- | --- |
| Kunde | Nur Kunden stehen zur Wahl, kein reiner Lieferant und kein archivierter Kontakt; der Eintrag gehört diesem Kunden. |
| Arbeitstag | Der Tag, an dem du gearbeitet hast. |
| Dauer | Als `1:30`, als Dezimalzahl `1,5` oder in Minuten `90 min`. Mindestens eine Minute, höchstens 24 Stunden; für mehr Zeit legst du mehrere Einträge an. |
| Abrechenbare Dauer | Optional. Leer gilt die erfasste Dauer. Eine andere Dauer, wenn du nur einen Teil berechnest, etwa 1:00 bei 1:30 erfasst. |
| Nicht abrechenbar | Erfasst, kommt aber nie in einen Rechnungsentwurf, etwa interne Zeit. Der Eintrag zählt in der Liste mit seiner Dauer, aber ohne Betrag. |
| Projekt | Optional, freier Text zum Gruppieren und Filtern. Haben hat keine Projektverwaltung: keine Budgets und keine eigenen Sätze je Projekt, siehe [Roadmap](roadmap.md#bewusst-nicht). |
| Stundensatz | Optional. Ohne Angabe nimmt Haben den Satz des Kunden, siehe unten. |
| Tätigkeit | Optional. Steht später auf der Rechnung. |

Die Liste zeigt die neuesten Arbeitstage zuerst und lässt sich nach Kunde und Zeitraum eingrenzen. Darunter stehen Anzahl, Stunden und Summe der Einträge im Filter; ein Eintrag ohne Stundensatz zählt in der Summe nicht mit. Einträge lassen sich ändern und löschen, solange sie auf keiner Rechnung stehen. Jede Änderung steht im Änderungsprotokoll. Der Filter **Stand** zeigt offene, abgerechnete und nicht abrechenbare Einträge.

## Stundensatz

Den Stundensatz eines Kunden pflegst du im **Kontakt** unter **Stundensatz**. Er ist die Vorgabe für neue Einträge dieses Kunden.

Jeder Eintrag **behält den Satz vom Anlegen** als Kopie. Erhöhst du später den Satz am Kunden, bleiben bestehende Einträge bei ihrem Satz; nur neue bekommen den neuen. So ändert sich der Betrag von Zeit, die schon erfasst ist, nicht rückwirkend. Hat der Kunde beim Anlegen keinen Satz und gibst du keinen an, bleibt der Eintrag ohne Satz; in der Liste steht dann „fehlt“. Den Satz trägst du am Eintrag nach.

Der Betrag eines Eintrags ist die abrechenbare Dauer mal Stundensatz, auf ganze Cent gerundet (halbe Cent weg von null): 90 Minuten zu 95,00 € sind 142,50 €, bei einer abrechenbaren Dauer von 1:00 sind es 95,00 €. Ein nicht abrechenbarer Eintrag hat keinen Betrag.

## Einträge aus einer Zeiterfassung

Zeiterfassungsprogramme legen Einträge über `POST /api/v1/leistungen` an. Mit `source` (etwa `kimai`) und `externalId` (die Nummer der Zeile in dem Programm) ist der Aufruf wiederholbar: Gibt es die Kennung schon, aktualisiert Haben den Eintrag, statt ihn zu verdoppeln. In der Liste steht „aus kimai“. Wie ein Abruf aus Kimai aussieht, steht in der [API-Beschreibung](api.md#zeitbuchungen-aus-kimai-holen).

Das Token braucht das Recht `leistungen:schreiben` (anlegen und löschen) oder `leistungen:lesen`. Der [Zugang der Steuerberatung](steuerberatung.md) sieht die Seite nicht: Zeiteinträge sind keine Buchführungsunterlage.

## Abrechnen

**Abrechnen** macht aus den offenen Einträgen eines Kunden einen Rechnungsentwurf:

1. Kunde und Zeitraum wählen. Vorgeschlagen ist in den ersten zehn Tagen eines Monats der vergangene Monat, sonst der laufende bis heute.
2. Haben zeigt vorab, wie viele Einträge es sind, wie viele Stunden und welche Summe netto herauskommt, und wie die Positionen aussehen.
3. **Rechnungsentwurf anlegen** öffnet den Entwurf. Prüfe ihn wie jeden Entwurf, ergänze ihn und schreibe ihn fest.

Was in den Entwurf kommt:

- Alle Einträge des Kunden im Zeitraum, die **abrechenbar** und noch **offen** sind. Nicht abrechenbare Einträge und solche, die schon auf einer Rechnung stehen, nimmt Haben nie mit.
- **Eine Position je Stundensatz**, Bezeichnung „Leistungen“, Einheit Std., Menge die Summe der abrechenbaren Dauern. Die Menge rundet Haben einmal je Position auf Tausendstel Stunden (100 Minuten sind 1,667 Std.), nicht je Eintrag. Die Projekte der Einträge stehen als Text unter der Position.
- **Leistungszeitraum** vom ersten bis zum letzten Arbeitstag der Einträge, Rechnungsdatum heute, Steuersatz und Zahlungsziel wie bei einem neuen Entwurf. Format (bei einer Leitweg-ID XRechnung), Sprache und Skonto übernimmt Haben vom Kunden, wie im Rechnungseditor.
- Fehlt bei einem Eintrag der Stundensatz, legt Haben nichts an: Trage ihn am Eintrag oder im Kontakt ein.

Die Einzelaufstellung (Tag, Dauer, Tätigkeit) steht noch nicht auf der Rechnung selbst; in Haben zeigt der Entwurf und die festgeschriebene Rechnung unter **Enthaltene Leistungen**, aus welchen Einträgen sie entstanden ist.

### Nicht zweimal abrechnen

- Ein Eintrag auf einer Rechnung ist mit ihr verknüpft; in der Liste steht die Rechnungsnummer (bzw. „Rechnungsentwurf“) als Link. Er lässt sich nicht noch einmal abrechnen, auch nicht, wenn zwei Abrechnungen gleichzeitig laufen.
- Solange die Rechnung ein **Entwurf** ist, lässt sich der Eintrag nicht ändern oder löschen. **Lösche den Entwurf**, dann ist er wieder offen.
- Mit der **festgeschriebenen** Rechnung ist er gesperrt: Dauer, Satz, Kunde, Tag, Text und die Verknüpfung ändern sich nicht mehr, auch nicht über die API.
- Ein **Storno** der Rechnung macht die Einträge wieder offen und änderbar; sie lassen sich auf eine neue Rechnung abrechnen. Eine **Korrektur** gibt sie nicht frei.
- Eine Zeiterfassung, die einen schon abgerechneten Eintrag erneut schickt, ändert ihn nicht und bekommt trotzdem `200`.

## Was noch nicht geht

Die Einzelaufstellung (Tag, Dauer, Tätigkeit) als Anlage zur Rechnung für den Kunden gibt es noch nicht. Bis dahin steht auf der Rechnung nur die Summe je Stundensatz.
