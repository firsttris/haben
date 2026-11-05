# Lohn

Unter **Personal › Lohn** legst du Mitarbeiter an, rechnest jeden Monat ab und schreibst die Abrechnung fest. Haben rechnet Lohnsteuer, Solidaritätszuschlag, Kirchensteuer und die Beiträge zur Sozialversicherung, erzeugt die Entgeltabrechnung als PDF und führt das Lohnkonto je Mitarbeiter und Jahr.

> [!IMPORTANT]
> Noch nicht dabei: die Buchung ins Journal, die Lohnsteuer-Anmeldung, die Lohnsteuerbescheinigung und die Meldungen an die Sozialversicherung. Den Lohn buchst du bis dahin wie bisher als [manuelle Buchung](buchhaltung.md) (GmbH und UG) bzw. als Beleg; Lohnsteuer-Anmeldung und Beitragsnachweis gibst du im ELSTER-Portal und im SV-Meldeportal ab. Was wann kommt, steht im [Plan](lohn-plan.md).

## Was Haben abrechnet

Haben rechnet nur Fälle, die es sicher kann; alles andere meldet es als „nicht unterstützt“ und rechnet es nicht (siehe [Plan](lohn-plan.md#vorgehen-vorschlag)). Drei Arten der Beschäftigung, in Stufen nach Risiko:

| Stufe | Beschäftigung | Was Haben rechnet |
| --- | --- | --- |
| A | Gesellschafter-Geschäftsführer ohne Sozialversicherungspflicht | Lohnsteuer, Soli und Kirchensteuer ohne Renten- und Arbeitslosenversicherung; freiwillig gesetzlich oder privat versichert, ohne Zuschuss des Arbeitgebers |
| B | Minijob im gewerblichen Bereich mit Pauschsteuer | Pauschalen zur Kranken- und Rentenversicherung, Pauschsteuer 2 %, Umlagen und Insolvenzgeldumlage (trägt alles der Arbeitgeber); vom Lohn ab geht nur der Anteil zur Rentenversicherung, ohne Befreiung 3,6 % |
| C | Sozialversicherungspflichtig Beschäftigte mit festem Monatsgehalt, gesetzlich versichert | Lohnsteuer, Soli, Kirchensteuer und alle Beiträge, auch im Übergangsbereich (Midijob). **Entwurf, gegenprüfen:** Festschreiben geht erst, wenn du bestätigst, dass die Abrechnung gegen ein Lohnprogramm oder die Steuerberatung gegengeprüft ist |

Nicht unterstützt sind Sonstige Bezüge (Einmalzahlungen, Abfindungen), Sachbezüge und Dienstwagen, Betriebsrente, Kurzarbeit, Pfändungen, Teilmonate (Eintritt oder Austritt im Monat), Mehrfachbeschäftigung, Steuerklasse VI, das Faktorverfahren, Freibeträge aus den ELStAM, privat versicherte Beschäftigte, ein Zuschuss zur privaten Krankenversicherung des Geschäftsführers, Minijobs mit Lohnsteuer nach den ELStAM und Minijobs im Privathaushalt. Kirchensteuer rechnet Haben für die Merkmale ev, rk, lt, rf und ak, mit 8 % in Baden-Württemberg und Bayern, sonst 9 %; maßgeblich ist das Bundesland in den [Firmendaten](einrichtung.md#firmendaten).

Gerechnet wird mit den Werten eines Jahres: dem Programmablaufplan des BMF für die Lohnsteuer und den Rechengrößen und Beitragssätzen der Sozialversicherung. Fehlen sie für ein Jahr, rechnet Haben nicht, auch nicht mit denen des Vorjahres („nicht hinterlegt“, siehe [Entwicklung](entwicklung.md#lohnsteuer-pap-jährlich-aktualisieren)).

## Mitarbeiter anlegen

**Mitarbeiter anlegen** fragt ab, was Abrechnung, Entgeltbescheinigung und Lohnkonto brauchen:

- **Person:** Name, Anschrift, Geburtsdatum, IBAN für die Auszahlung.
- **Beschäftigung:** Art (Stufe A, B oder C), Monatsgehalt brutto, Eintritt und Austritt. Beim Gesellschafter-Geschäftsführer zusätzlich der Stand der Statusfeststellung (§ 7a SGB IV): Solange sie keine Versicherungsfreiheit ergeben hat, steht ein Hinweis an der Abrechnung; hat sie Versicherungspflicht ergeben, rechnet Haben ihn nicht mehr ohne Sozialversicherung.
- **Lohnsteuerabzugsmerkmale (ELStAM):** Steuer-ID, Steuerklasse, Kinderfreibeträge und Kirchensteuermerkmal. Den Abruf über ELSTER gibt es noch nicht; du überträgst die Merkmale aus dem ELSTER-Portal (Arbeitgeber › ELStAM).
- **Kranken- und Pflegeversicherung:** gesetzlich mit dem Zusatzbeitrag der Kasse oder privat mit dem Monatsbeitrag zur Basisabsicherung; Zuschlag für Kinderlose und Kinder unter 25 für die Pflegeversicherung. Bei Beschäftigten (Stufe C) Krankenkasse mit Betriebsnummer und die Umlagesätze U1 und U2 der Kasse.
- **Meldedaten der Sozialversicherung** (Stufen B und C): Versicherungsnummer, Personengruppe, Beitragsgruppenschlüssel und Tätigkeitsschlüssel. Haben rechnet nicht mit ihnen, druckt sie aber auf die Entgeltbescheinigung. Im Minijob zusätzlich Pauschsteuer, Befreiung von der Rentenversicherung und die Teilnahme am U1-Verfahren; die Sätze sind die der Minijob-Zentrale.

Personalnummern vergibt Haben fortlaufend. Stammdaten lassen sich jederzeit ändern; eine Abrechnung hält den Stand fest, mit dem sie gerechnet ist.

## Monat abrechnen

Wähle Monat und Jahr, trage den **Zahltag** ein und klicke **Monat abrechnen**. Für jeden Mitarbeiter, der im ganzen Monat beschäftigt ist und noch keine Abrechnung hat, entsteht ein Entwurf. Wer sich nicht rechnen lässt, bekommt keinen Entwurf; der Grund steht an seinem Namen:

| Grund | Bedeutung |
| --- | --- |
| nicht hinterlegt | Für das Jahr fehlen Programmablaufplan oder Werte der Sozialversicherung |
| nicht unterstützt | Ein Fall aus der Liste oben, etwa ein Teilmonat |
| ungültig | Eine Angabe passt nicht, etwa ein Minijob über 603 € oder ein Monat außerhalb der Beschäftigung |

**Regelmäßiges Entgelt:** Ob eine Beschäftigung im Übergangsbereich liegt, entscheidet das regelmäßige Entgelt (§ 20 Abs. 2 SGB IV), nicht der einzelne Monat. Haben nimmt dafür das Monatsgehalt aus den Stammdaten. Im Entwurf kannst du für diesen Monat ein anderes Entgelt eintragen und **Neu berechnen**; liegt es in einem anderen Bereich als das Monatsgehalt (bis 603 €, Übergangsbereich bis 2.000 €, darüber), rechnet Haben nicht, weil die Beiträge dann nach eigenen Regeln bemessen werden (§ 2 Abs. 2 BVV).

## Prüfen und festschreiben

Der Entwurf zeigt Brutto, Steuern, den Anteil zur Sozialversicherung, Netto, Auszahlung und was der Arbeitgeber zusätzlich trägt. **Entwurf ansehen (PDF)** zeigt die Entgeltabrechnung mit dem Vermerk „Entwurf“. Ändern sich danach die Stammdaten, rechnest du den Entwurf neu; ein Entwurf lässt sich auch löschen.

**Festschreiben** setzt das PDF, speichert es mit der Abrechnung und sperrt beides. Haben lehnt das Festschreiben ab, solange für die Entgeltbescheinigung etwas fehlt (Anschrift, Steuer-ID, bei Sozialversicherung Versicherungsnummer, Personengruppe, Beitragsgruppen und Einzugsstelle) oder die Stammdaten seit dem Entwurf geändert sind. In Stufe C setzt du vorher den Haken „gegengeprüft“.

Festgeschriebene Abrechnungen sind wie Rechnungen und Buchungen in der Datenbank gesperrt und versiegelt; jede Änderung an Stammdaten, Lohnlauf und Abrechnung steht im Änderungsprotokoll (siehe [GoBD](buchhaltung.md#gobd-unveränderbarkeit-in-der-datenbank)).

## Storno und Korrektur

Eine festgeschriebene Abrechnung korrigierst du mit **Stornieren**: Haben hält das Storno mit Tag und Grund in einer eigenen, versiegelten Zeile fest, lässt die Abrechnung selbst unverändert und legt gleich einen neuen Entwurf für denselben Monat mit den aktuellen Stammdaten an. Der neue Entwurf verweist auf die stornierte Abrechnung.

## Entgeltabrechnung

Das PDF ist die Abrechnung in Textform nach § 108 Abs. 1 GewO und als Bescheinigung nach § 108 Abs. 3 Satz 1 GewO gekennzeichnet (§ 1 Abs. 4 EntgBV). Es enthält die Angaben aus § 1 der Entgeltbescheinigungsverordnung:

- Arbeitgeber, Beschäftigter mit Anschrift und Geburtsdatum, Versicherungsnummer, Beginn und im letzten Monat Ende der Beschäftigung, Abrechnungszeitraum mit Steuer- und SV-Tagen;
- Steuerklasse, Kinderfreibeträge, Kirchensteuermerkmal und Steuer-ID; Beitragsgruppenschlüssel, Einzugsstelle, Kennziffer der Pflegeversicherung, gegebenenfalls Übergangsbereich;
- jeden Bezug mit Art und Wirkung auf Steuer-, SV- und Gesamtbrutto, die Bruttoentgelte, die gesetzlichen Abzüge, Netto und Auszahlungsbetrag;
- zur Information, was der Arbeitgeber zusätzlich trägt.

Das Kirchensteuermerkmal darf der Beschäftigte schwärzen (§ 2 Abs. 2 EntgBV).

## Lohnkonto

Für jeden Mitarbeiter und jedes Jahr führt Haben das Lohnkonto (§ 41 Abs. 1 EStG) aus den festgeschriebenen Abrechnungen, als **PDF** oder **CSV** in der Mitarbeiterliste und auf der Seite des Mitarbeiters. Es enthält die Angaben nach § 4 LStDV: Name, Geburtstag, Wohnung, die Besteuerungsmerkmale (je Abrechnung, so ist eine Änderung im Jahr zu sehen) und je Lohnzahlung Tag, Zeitraum, Arbeitslohn, Lohnsteuer, Soli, Kirchensteuer, pauschal besteuerte Bezüge mit Pauschsteuer und die Beiträge zur Sozialversicherung. Ein Storno steht mit negativen Beträgen am Tag des Stornos.

Aufbewahren musst du das Lohnkonto bis zum Ablauf des sechsten Kalenderjahres nach der letzten Lohnzahlung (§ 41 Abs. 1 Satz 9 EStG); das PDF nennt das Datum.

## Quellen

- § 108 GewO: <https://www.gesetze-im-internet.de/gewo/__108.html>
- Entgeltbescheinigungsverordnung §§ 1 und 2: <https://www.gesetze-im-internet.de/entgbv/__1.html>, <https://www.gesetze-im-internet.de/entgbv/__2.html>
- § 41 EStG: <https://www.gesetze-im-internet.de/estg/__41.html>; § 4 LStDV: <https://www.gesetze-im-internet.de/lstdv/__4.html>
- § 20 Abs. 2 SGB IV (Übergangsbereich): <https://www.gesetze-im-internet.de/sgb_4/__20.html>; § 2 BVV: <https://www.gesetze-im-internet.de/beitrvv/__2.html>
