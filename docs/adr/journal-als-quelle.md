---
title: "Entwurf: Voranmeldung und EÜR aus dem Journal"
description: >-
  Entscheidungsvorlage zu #542: ab einem Stichjahr rechnen Voranmeldung und EÜR aus dem Journal wie bei DATEV, die
  Nebenbücher werden zur Gegenprobe; Grundlage für freie Buchungen mit Steuerschlüssel (#502).
---

# Entwurf: Voranmeldung und EÜR aus dem Journal

**Status:** Entwurf, Umsetzung in Schritten (siehe unten). **Stand:** `main` nach den Pull Requests #543 bis #573.
**Bezug:** [#542](https://github.com/firsttris/haben/issues/542), [#502](https://github.com/firsttris/haben/issues/502),
[Architektur: Entwurfsentscheidungen](../architektur.md#entwurfsentscheidungen), [Abgleich](../buchhaltung.md#abgleich-von-journal-umsatzsteuer-und-eür).
DATEV-Hilfe-Center: [1080673](https://help-center.apps.datev.de/documents/1080673) (Ist-Versteuerung),
[1049448](https://help-center.apps.datev.de/documents/1049448) (Steuerschlüssel bei Zahlung),
[1036819](https://help-center.apps.datev.de/documents/1036819), [1029628](https://help-center.apps.datev.de/documents/1029628),
[1036906](https://help-center.apps.datev.de/documents/1036906) (EÜR aus der Finanzbuchhaltung).

## Ausgangslage

Bisher gilt: Umsatzsteuer und EÜR rechnen aus den Nebenbüchern (Rechnungen, Belege, Zuordnungen, Kasse, Pauschalen,
Anlagenverzeichnis), das Journal dient zum Abgleich. Eine Buchung, die nur im Journal steht, etwa eine freie Buchung mit
Soll, Haben und Steuerschlüssel, käme deshalb nie in Voranmeldung und EÜR an.

Seit #543 bis #573 trägt das Journal alles, was beide Formulare brauchen, und der Abgleich prüft es:

| Baustein | Pull Request |
| --- | --- |
| Kz 45 bei Ist nach Rechnungsdatum wie DATEV | #543 |
| Kennzahlen aus Konto und Steuerschlüssel (`journal-kennzahlen.ts`) | #545 |
| Abgleich aller Kennzahlen | #547 |
| § 13b ohne Vorsteuerabzug und mit Privatanteil als eigene Zeilen | #551 |
| Bemessungsgrundlage an der Zahlung bei Ist (`journal_lines.basis`) | #552 |
| EÜR-Zeilen aus Konto und Herkunft (`journal-euer.ts`) | #557 |
| EÜR je Zeile aus dem Journal, Zahlungen anteilig auf die ausgeglichene Buchung (`euer-journal.ts`) | #562 |
| Gewinn nach der DATEV-Formel als Gegenprobe (`euer-formel.ts`) | #567 |
| Gegenbuchung nach Kontenrahmenwechsel im neuen Rahmen | #570 |
| Korrektur übernommener Lexoffice-Rechnungen mit Steuerschlüssel | #573 |

Messung über die ganze Postgres-Suite (bei jedem Aufruf der heutigen Rechnung die Rechnung aus dem Journal daneben):

- Voranmeldung: 1397 Zeiträume; bei Soll 483 von 487 gleich, bei Ist 711 von 910. Jede Abweichung hat eine benannte
  Ursache: Privatnutzung von Fahrzeugen vor dem Buchen der AfA, ältere Zahlungen ohne Bemessungsgrundlage, der
  Manipulationstest, Testdaten ohne Buchung, die Lexoffice-Korrektur (behoben in #573).
- EÜR je Zeile: 299 von 344 gleich; Gewinn nach der Formel 349 von 399; Ursachen ebenso benannt (AfA und Privatnutzung
  vor dem Buchen, Lexoffice-Übernahmen bei den Zeilen, Testdaten ohne Buchung, Manipulationstest).

## Entscheidungen

### 1. Stichjahr statt Umbau der Vergangenheit

Ab einem **Stichjahr** sind Voranmeldung und EÜR aus dem Journal; davor bleibt alles, wie es ist.

- Gesendete Voranmeldungen ändern sich nie: Gesendet ist gesendet, die Werte stehen in `vat_returns`.
- Abgeschlossene Jahre und Jahre vor dem Stichjahr rechnen weiter aus den Nebenbüchern. Dort stehen Buchungen, denen
  Bemessungsgrundlage oder Steuerschlüssel fehlen (vor #551, #552, #573); neu rechnen hieße, Zahlen zu ändern, die
  angemeldet sind.
- Das Stichjahr steht in den Firmendaten (`company.journal_ab`, Jahr). Eine Migration setzt es für Instanzen mit
  Buchungen auf das **nächste Kalenderjahr** nach dem Update; ohne Buchungen bleibt es leer und gilt ab dem Jahr der
  ersten Buchung. So beginnt jede bestehende Instanz mit einem vollen Jahr, dessen Buchungen alle neuen Bausteine tragen.
- **Vorziehen auf das laufende Jahr** geht in den Einstellungen, solange im Jahr keine Voranmeldung gesendet ist und der
  Abgleich des Jahres keine Abweichung zeigt. Zurück geht es nicht, sobald eine Voranmeldung aus dem Journal gesendet ist.
- Bis zum Stichjahr läuft die Rechnung aus dem Journal als Gegenprobe im Abgleich mit (Haltepunkt, Schritt 6 in #542):
  Weicht etwas ab, zeigt es die Integritätsprüfung, bevor das Journal die Quelle wird.

### 2. Voranmeldung ab dem Stichjahr

- Die **Kennzahlen** (Bemessungsgrundlagen und Steuer, Kz 21 bis 93) kommen aus `kennzahlenAusJournal` über die
  Buchungen des Zeitraums, wie bei DATEV aus Konto und Steuerschlüssel. Bei Ist zählt ein Verkauf auf Ziel mit der
  Zahlung, die die Bemessungsgrundlage trägt (DATEV 1080673).
- **Privatnutzung von Fahrzeugen:** Das Journal bucht sie je Monat zum Monatsende, aber erst mit der AfA des Jahres.
  Solange ein Monat nicht gebucht ist, kommt seine Privatnutzung aus dem Anlagenverzeichnis dazu (wie die AfA in der
  EÜR). Mit dem Buchen steht sie im Journal und der Zusatz entfällt; die Summe bleibt gleich.
- Was die Oberfläche und die Vorprüfung zusätzlich zeigen (Erlöse je Rechnung, § 13b je Beleg, Hinweise), kommt weiter aus
  den Nebenbüchern; es sind Erläuterungen, keine Kennzahlen.
- Der **Abgleich** bleibt derselbe, die Rollen tauschen: Quelle ist das Journal, Gegenprobe die Nebenbücher. Eine
  Abweichung heißt wie bisher, dass eine Seite falsch ist oder Daten an Haben vorbei geändert wurden; die Vorprüfung warnt
  vor dem Senden.

### 3. EÜR ab dem Stichjahr

- Die **Zeilen** kommen aus `euerAusJournal`: Buchungen ohne offenen Posten nach ihren Konten, Rechnungen und Belege auf
  Ziel mit jeder Zahlung anteilig, gerundet wie der beim Zuordnen gespeicherte Anteil (#562).
- **AfA und Privatnutzung**: aus dem Journal, sobald das Jahr gebucht ist; vorher aus dem Anlagenverzeichnis mit dem
  bestehenden Hinweis „noch nicht gebucht“.
- **Zahlungen auf aus Lexoffice übernommene Rechnungen und Belege**: Deren Buchung steht gegen den Saldenvortrag ohne Erlös-
  und Aufwandszeilen. Für diese Zahlungen rechnet die Zeile aus dem Nebenbuch (Summen und Kategorie des übernommenen
  Postens); im Gewinn nach der Formel zählt der Saldenvortrag (#567).
- Der **Gewinn nach der DATEV-Formel** bleibt die Gegenprobe zum Gewinn aus den Zeilen.
- Nur im Einzelunternehmen; GmbH und UG bilanzieren (#567).

### 4. Freie Buchungen (#502)

Mit dem Journal als Quelle wird eine freie Buchung zu einem weiteren Weg in `ledger.post`, wie bei DATEV:

- Eingabe: Datum, Text, Soll-Konto, Haben-Konto, Betrag (brutto) und ein **Steuerschlüssel** aus der festen Liste
  (`TaxCode`). Haben teilt in Netto und Steuer und bucht die Steuerzeile auf das Konto des Schlüssels, wie die
  DATEV-Automatik; die Bemessungsgrundlage steht an der Netto-Zeile.
- **Vor dem Buchen geprüft** (Buchungen sind sofort festgeschrieben): Das Konto mit dem Steuerschlüssel muss ein
  Erfolgskonto sein, der Schlüssel zur Seite passen (Umsatzsteuer auf Erträge, Vorsteuer auf Aufwand); Konten, die ein
  Nebenbuch führt (Forderungen, Verbindlichkeiten, Kasse, Bank), Steuerkonten direkt und Anlagekonten sind ausgeschlossen.
  Unbekannte Kombinationen lehnt Haben ab.
- Ab dem Stichjahr wirken freie Buchungen in Voranmeldung und EÜR; davor lehnt Haben sie im Einzelunternehmen ab, weil die
  Nebenbücher sie nicht sähen.

## Umsetzung

1. Stichjahr in den Firmendaten (Migration, Anzeige unter Einstellungen), Voranmeldung ab dem Stichjahr aus dem Journal,
   Abgleich mit getauschten Rollen. Tests für SKR03 und SKR04, Ist und Soll, mit und ohne Privatnutzung, über den Wechsel
   des Stichjahrs.
2. EÜR ab dem Stichjahr aus dem Journal, mit AfA, Privatnutzung und Lexoffice-Zahlungen wie oben.
3. Freie Buchungen mit Steuerschlüssel ab dem Stichjahr (#502).
4. `architektur.md` (Entscheidung „Umsatzsteuer und EÜR aus den Nebenbüchern“), `umsatzsteuer.md`, `auswertungen.md`,
   `buchhaltung.md` im jeweiligen Pull Request.

## Entschieden und offen

- **Entschieden:** Stichjahr statt Umbau; Vorziehen auf das laufende Jahr nur mit sauberem Abgleich und ohne gesendete
  Voranmeldung; Kennzahlen und EÜR wie DATEV aus dem Journal; Privatnutzung und AfA vor dem Buchen aus dem
  Anlagenverzeichnis; Lexoffice-Zahlungen aus dem Nebenbuch; freie Buchungen nur ab dem Stichjahr.
- **Offen:** nichts; Abweichungen von diesem Entwurf beim Umsetzen stehen hier nach.
