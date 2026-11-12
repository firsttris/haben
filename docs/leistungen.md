---
title: "Leistungen und Zeiteinträge erfassen"
description: >-
  Zeiteinträge je Kunde mit Stundensatz erfassen, von Hand oder aus einem Zeiterfassungsprogramm wie Kimai über
  die REST-API, als Grundlage für die Rechnung.
---

# Leistungen

Unter **Leistungen** erfasst du abrechenbare Zeit je Kunde: Arbeitstag, Dauer, Tätigkeit und Stundensatz. Wer nach Stunden abrechnet, hat die Zeiten dort, wo auch die Rechnung entsteht, und muss sie nicht aus einem anderen Programm abtippen. Eine Zeiterfassung wie Kimai oder Toggl schickt ihre Einträge über die [REST-API](api.md#leistungen-und-zeiterfassung) an Haben.

Eine Buchung entsteht aus einem Eintrag nicht: Er ist nur die Grundlage, aus der später die Rechnung wird. Gebucht wird wie immer erst, wenn du die Rechnung festschreibst.

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

Die Liste zeigt die neuesten Arbeitstage zuerst und lässt sich nach Kunde und Zeitraum eingrenzen. Darunter stehen Anzahl, Stunden und Summe der Einträge im Filter; ein Eintrag ohne Stundensatz zählt in der Summe nicht mit. Einträge lassen sich ändern und löschen. Jede Änderung steht im Änderungsprotokoll.

## Stundensatz

Den Stundensatz eines Kunden pflegst du im **Kontakt** unter **Stundensatz**. Er ist die Vorgabe für neue Einträge dieses Kunden.

Jeder Eintrag **behält den Satz vom Anlegen** als Kopie. Erhöhst du später den Satz am Kunden, bleiben bestehende Einträge bei ihrem Satz; nur neue bekommen den neuen. So ändert sich der Betrag von Zeit, die schon erfasst ist, nicht rückwirkend. Hat der Kunde beim Anlegen keinen Satz und gibst du keinen an, bleibt der Eintrag ohne Satz; in der Liste steht dann „fehlt“. Den Satz trägst du am Eintrag nach.

Der Betrag eines Eintrags ist die abrechenbare Dauer mal Stundensatz, auf ganze Cent gerundet (halbe Cent weg von null): 90 Minuten zu 95,00 € sind 142,50 €, bei einer abrechenbaren Dauer von 1:00 sind es 95,00 €. Ein nicht abrechenbarer Eintrag hat keinen Betrag.

## Einträge aus einer Zeiterfassung

Zeiterfassungsprogramme legen Einträge über `POST /api/v1/leistungen` an. Mit `source` (etwa `kimai`) und `externalId` (die Nummer der Zeile in dem Programm) ist der Aufruf wiederholbar: Gibt es die Kennung schon, aktualisiert Haben den Eintrag, statt ihn zu verdoppeln. In der Liste steht „aus kimai“. Wie ein Abruf aus Kimai aussieht, steht in der [API-Beschreibung](api.md#zeitbuchungen-aus-kimai-holen).

Das Token braucht das Recht `leistungen:schreiben` (anlegen und löschen) oder `leistungen:lesen`. Der [Zugang der Steuerberatung](steuerberatung.md) sieht die Seite nicht: Zeiteinträge sind keine Buchführungsunterlage.

## Was noch nicht geht

Aus den Einträgen entsteht noch keine Rechnung; das Abrechnen kommt als Nächstes. Bis dahin tippst du Stunden und Satz als Position in den Rechnungsentwurf ein.
