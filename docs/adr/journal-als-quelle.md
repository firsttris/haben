---
title: "Entwurf: Voranmeldung und EÜR aus dem Journal"
description: >-
  Entscheidungsvorlage zu #542: ab einem Stichjahr rechnen Voranmeldung und EÜR aus dem Journal wie bei DATEV, die
  Nebenbücher werden zur Gegenprobe; Grundlage für freie Buchungen mit Steuerschlüssel (#502).
---

# Entwurf: Voranmeldung und EÜR aus dem Journal

**Status:** Entwurf, Umsetzung in Schritten (siehe unten). **Stand:** `main` nach den Pull Requests #543 bis #573 (`7e3ce67`).
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
- **Privatnutzung von Fahrzeugen:** Sie kommt in der Voranmeldung immer aus dem Anlagenverzeichnis, je Monat; die
  Buchungen des Anlagenverzeichnisses zählen in den Kennzahlen aus dem Journal nicht. Grund: Das Journal bucht sie erst mit
  der AfA des Jahres (frühestens im Dezember), und bei Hybrid- und Elektroautos ist die Bemessungsgrundlage der
  Umsatzsteuer (§ 3 Abs. 9a UStG, aus der 1-%-Regel mit dem vollen Listenpreis) höher als die Entnahme nach § 6 Abs. 1
  Nr. 4 EStG mit dem halben bzw. geviertelten Listenpreis; die Erlöszeile trägt dann keinen Steuerschlüssel (`privateUsePosting`). Das Journal bucht
  dieselben Beträge; der Abgleich der EÜR vergleicht sie, sobald das Jahr gebucht ist. Dass sich die Privatnutzung nach
  einer gesendeten Voranmeldung noch ändern lässt (bis zum Buchen der AfA), ist bestehendes Verhalten und bleibt; eine
  Sperre ab dem ersten gemeldeten Monat wäre ein eigener Schritt.
- Was die Oberfläche und die Vorprüfung zusätzlich zeigen (Erlöse je Rechnung, § 13b je Beleg, Hinweise), kommt weiter aus
  den Nebenbüchern; es sind Erläuterungen, keine Kennzahlen. Die Zusammenfassende Meldung (§ 18a UStG) rechnet weiter aus
  den Rechnungen, sie braucht die USt-IdNr. des Empfängers.
- Die **Umsatzsteuererklärung** summiert die Monate über dieselbe Rechnung (`annual.ts`) und folgt damit von selbst.
- Der **Abgleich** bleibt derselbe, die Rollen tauschen: Quelle ist das Journal, Gegenprobe die Nebenbücher. Eine
  Abweichung heißt wie bisher, dass eine Seite falsch ist oder Daten an Haben vorbei geändert wurden; die Vorprüfung warnt
  vor dem Senden.

### 3. EÜR ab dem Stichjahr

- Die **Zeilen** kommen aus `euerAusJournal`: Buchungen ohne offenen Posten nach ihren Konten, Rechnungen und Belege auf
  Ziel mit jeder Zahlung anteilig, gerundet wie der beim Zuordnen gespeicherte Anteil (#562). Welche Buchung eine Zahlung
  ausgleicht, sagt die Zuordnung im Nebenbuch; bei Teilzahlungen auf Belege mit Privatanteil oder ohne Vorsteuerabzug
  rundet sie mit den Beträgen des Belegs. Das Nebenbuch liefert dort also die Verbindung, nicht die Beträge.
- **AfA und Privatnutzung**: aus dem Journal, sobald das Jahr gebucht ist; vorher aus dem Anlagenverzeichnis mit dem
  bestehenden Hinweis „noch nicht gebucht“.
- **Zahlungen auf aus Lexoffice übernommene Rechnungen und Belege**: Deren Buchung steht gegen den Saldenvortrag ohne Erlös-
  und Aufwandszeilen. Für diese Zahlungen rechnet die Zeile aus dem Nebenbuch (Summen und Kategorie des übernommenen
  Postens); im Gewinn nach der Formel zählt der Saldenvortrag (#567).
- Der **Gewinn nach der DATEV-Formel** bleibt die Gegenprobe zum Gewinn aus den Zeilen.
- Nur im Einzelunternehmen; GmbH und UG bilanzieren (#567).

### 4. Freie Buchungen (#502)

Mit dem Journal als Quelle bekommen die bestehenden manuellen Buchungen (`manual.ts`, Herkunft „manuell“, heute nur GmbH
und UG und ohne Umsatzsteuer) einen Steuerschlüssel; es entsteht kein zweiter Weg daneben. Wie bei DATEV:

- Eingabe: Datum, Text, Soll-Konto, Haben-Konto, Betrag (brutto) und ein **Steuerschlüssel**. Haben teilt in Netto und
  Steuer und bucht die Steuerzeile auf das Konto des Schlüssels, wie die DATEV-Automatik; die Netto-Zeile trägt den
  Schlüssel. Die automatische Steuerzeile ist erlaubt, obwohl `manualPostingIssues` Umsatzsteuerkonten sonst als Nebenbuch
  sperrt; von Hand bebucht werden sie weiter nicht.
- **Erlaubte Schlüssel**, ausdrücklich: `USt19`, `USt7` und `frei` auf ein Konto der festen Liste für Erlöse und
  Entnahmen. Keine Vorsteuer: Eine freie Buchung ist ein Eigenbeleg, der Vorsteuerabzug braucht eine Rechnung
  (§ 15 Abs. 1 Nr. 1 Satz 2 UStG, §§ 14, 14a UStG); dafür gibt es Belege, auch privat bezahlt. Aufwand ohne Vorsteuer bucht
  eine freie Buchung ohne Schlüssel bzw. mit `keineVSt`. Nicht erlaubt sind § 13b, innergemeinschaftlicher Erwerb und
  Einfuhrumsatzsteuer (ohne Brutto, das sich teilen ließe; die Einfuhrumsatzsteuer braucht den Bescheid), Reverse Charge
  und innergemeinschaftliche Lieferung (sie gehören in die Zusammenfassende Meldung, die aus den Rechnungen rechnet),
  Ausfuhr, Drittland und `Steuerfrei` (ohne Nachweis bzw. Rechnung). Als Kleinunternehmer (Stand am Buchungstag) gibt es
  keinen Steuerschlüssel (§ 19 Abs. 1 UStG).
- **Feste Kontenliste je SKR03 und SKR04**, jedes Konto mit einer EÜR-Zeile: die Erlöskonten 19 %, 7 % und 0 % (die
  `manualPostingIssues` heute als Nebenbuch Rechnungen sperrt, für freie Buchungen mit Schlüssel geöffnet) und die
  Sachentnahme (SKR03 8910, SKR04 4620; unentgeltliche Wertabgabe nach § 3 Abs. 1b UStG). Die Sachentnahme bekommt eine
  eigene Zeile der Anlage EÜR („Sonstige Sach-, Nutzungs- und Leistungsentnahmen“, § 6 Abs. 1 Nr. 4 Satz 1 EStG), ihre
  Umsatzsteuer zählt wie bei der Privatnutzung als Umsatzsteuer auf unentgeltliche Wertabgaben. Die Konten der
  Privatnutzung von Fahrzeugen sind ausgeschlossen; sie rechnet das Anlagenverzeichnis, sonst zählte sie doppelt.
- **Gegenkonto** einer Zeile mit Steuerschlüssel ist im Einzelunternehmen ein Erfolgs- oder ein Privatkonto (Entnahme,
  Einlage), in GmbH und UG ein Erfolgskonto oder das Gesellschafter-Verrechnungskonto (unentgeltliche Wertabgabe an
  Gesellschafter, § 3 Abs. 1b Nr. 2 UStG); Privatkonten gibt es dort nicht. Konten, die ein Nebenbuch führt (Forderungen,
  Verbindlichkeiten, Kasse, Bank), Steuerkonten direkt und Anlagekonten sind ausgeschlossen. Damit gibt es keinen Verkauf
  auf Ziel ohne Rechnung, dessen Steuer bei Ist erst mit der Zahlung entstünde (§ 13 Abs. 1 Nr. 1 Buchst. b UStG).
- **Datum:** nicht in einem gemeldeten Zeitraum nach derselben Regel wie beim Storno eines Belegs (`periodReported` in
  `belege/cancellation.ts`, dann über `belege/index.ts`): gesendete Voranmeldung, gesendete Umsatzsteuererklärung des
  Jahres (auch ohne Voranmeldungspflicht) oder abgeschlossenes Jahr.
- **Storno:** Die Gegenbuchung übernimmt die Steuerschlüssel (und Bemessungsgrundlagen) der Zeilen, damit sich auch die
  Bemessungsgrundlagen aufheben. Sie bucht in den laufenden Zeitraum, wenn der ursprüngliche gemeldet ist, wie beim Beleg.
  Liegt dazwischen ein Wechsel des Kontenrahmens, überträgt sie die Konten wie #570 (`kontoImKontenrahmen`); die Konten der
  festen Liste haben alle eine Entsprechung, sonst lehnt Haben ab.
- Unbekannte Kombinationen lehnt Haben vor dem Buchen ab; Buchungen sind sofort festgeschrieben.
- Freie Buchungen mit Steuerschlüssel gibt es nur ab dem Stichjahr, in jeder Rechtsform; davor sähe die Voranmeldung aus
  den Nebenbüchern sie nicht. Im Einzelunternehmen wirken sie ab dem Stichjahr auch in der EÜR.

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
  Voranmeldung; Kennzahlen und EÜR wie DATEV aus dem Journal; Privatnutzung in der Voranmeldung immer aus dem
  Anlagenverzeichnis, AfA und Privatnutzung in der EÜR vor dem Buchen ebenso; Lexoffice-Zahlungen aus dem Nebenbuch;
  freie Buchungen als Erweiterung der manuellen Buchungen, nur ab dem Stichjahr, mit fester Liste der Schlüssel und Konten,
  ohne Vorsteuer (Eigenbeleg), Storno mit Steuerschlüssel.
- **Offen:** nichts; Abweichungen von diesem Entwurf beim Umsetzen stehen hier nach.
- **Umgesetzt:** Schritt 1 ohne Oberfläche (Stichjahr, Migration 0192, Voranmeldung aus dem Journal, Abgleich mit
  getauschten Rollen). Anzeige und Vorziehen des Stichjahrs in den Einstellungen folgen in einem eigenen Pull Request.
  Ergänzt beim Umsetzen: Ein Storno im Stichjahr kopierte die Zeilen einer Buchung aus der Zeit davor samt ihrer Lücken
  (ohne Bemessungsgrundlage an der Zahlung, #552; ohne Steuerschlüssel am privaten Teil bei § 13b und Erwerb, #551). Der
  Storno einer Bareinnahme auf eine Rechnung und eines Belegs aus der Zeit vor dem Stichjahr bucht deshalb die Zeilen, wie
  Haben sie heute aus dem Nebenbuch bucht, wenn sie auf jedem Konto denselben Saldo ergeben (`zeilenWieHeute`); sonst die
  gebuchten. Die Zuordnung im Bankabgleich und Ausbuchungen mit einer Zahlung heben am Tag der Zahlung auf, also im alten
  Jahr.
  Schritt 2: EÜR aus dem Journal (`euer-quelle.ts`). Abweichend vom Entwurf rechnet sie Zahlungen auf übernommene
  Lexoffice-Posten nicht aus dem Nebenbuch, sondern verteilt sie auf die Zeilen, die Haben für Rechnung bzw. Beleg gebucht
  hätte (`uebernommeneZeilen`); so gilt für sie dieselbe Rundung, und der Abgleich vergleicht sie ohne Ausnahme.
  Schritt 3: freie Buchungen (`freie-buchung.ts` in core, `manual.ts`): Steuerschlüssel `USt19`, `USt7`, `frei` auf den
  Erlöskonten 19 %, 7 % und 0 %, im Einzelunternehmen auch ohne Schlüssel erst ab dem Stichjahr. Die Gegenprobe im
  Abgleich zählt sie aus der festgeschriebenen Buchung selbst (sie haben kein Nebenbuch). Abweichend vom Entwurf noch ohne
  die Sachentnahme (SKR03 8910, SKR04 4620): Für ihre eigene Zeile der Anlage EÜR und die Kennzahl fehlt hier noch die
  geprüfte Zuordnung im ELSTER-Formular; sie folgt mit eigenem Pull Request.
