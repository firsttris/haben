# Lohn in Haben – Recherche und Umsetzungsplan

Stand: 5. November 2026. PR 1 bis 4 sind umgesetzt, der Rest ist Plan. Ein Teil der Angaben stützt sich auf Sekundärquellen; sie sind mit „prüfen“ markiert und vor der Umsetzung am Original zu bestätigen.

## Kurzfazit

- **Rechnen geht ohne Zertifizierung.** Lohnsteuer, Soli und Kirchensteuer nach dem Programmablaufplan (PAP) des BMF. SV-Beiträge nach Rechengrößen und Beitragssätzen. Buchungen ins Journal.
- **Finanzamt geht über ERiC mit der vorhandenen Hersteller-ID.** Lohnsteuer-Anmeldung (Verfahren ElsterAnmeldung, Datenart LStA) wie UStVA und KapEStA. Die elektronische Lohnsteuerbescheinigung (LStB) ebenso. Der ELStAM-Abruf läuft auch über ERiC, braucht aber ein Organisationszertifikat; ob der Hersteller dafür extra freigeschaltet sein muss, ist offen.
- **Sozialversicherung geht nicht direkt.** Meldungen und Beitragsnachweise sind nur aus systemgeprüften Programmen oder systemgeprüften Ausfüllhilfen zulässig (§ 95b Abs. 1 SGB IV, vorher § 28a Abs. 1 Satz 2 und 3). Die Systemprüfung führt der GKV-Spitzenverband durch (§ 95b Abs. 4), praktisch die ITSG in seinem Auftrag, mit Pilotphase, laufender Kontrolle und befristetem Zertifikat. Das ist für ein Open-Source-Projekt nicht realistisch.
- **sv.net gibt es nicht mehr.** sv.net war seit 2. Januar 2024 nur noch eingeschränkt nutzbar und wurde zum 30. Juni 2024 endgültig abgeschaltet (TK). Geplant war der 29. Februar 2024; den Termin haben die Träger kurzfristig verschoben (DRV, März 2024), daher nennen ältere Texte wie der von Lexware noch dieses Datum. Nachfolger ist das SV-Meldeportal der ITSG, seit 4. Oktober 2023, eine Ausfüllhilfe nach § 95a SGB IV (Benutzerhandbuch, Kap. 2). Belegt am Portal selbst (Stand November 2026):
  - **Kosten:** 36 € netto für 36 Monate mit einer Betriebsnummer (Single-Mandant), 99 € netto mit mehreren (Multi-Mandant), jeweils im Voraus; kostenlos nur für Selbstständige ohne Arbeitnehmer und für Anträge auf Zahlstellen- oder Absendernummer (Seite „Registrierung“, Fragen und Antworten 2.3 und 2.4).
  - **Voraussetzung:** Registrierung und jede Anmeldung mit dem ELSTER-Organisationszertifikat über „Mein Unternehmenskonto“, nur in Ausnahmefällen mit der BundID; ohne eines von beiden keine Registrierung (Benutzerhandbuch, Kap. 2 und 2.1).
  - **Rechnet nicht:** Das Portal „führt keine Berechnungen zur Ermittlung der erforderlichen Angaben durch“ (Seite „Einführung“, Flyer). Entgelte, Beiträge und Beitragsgruppen muss Haben liefern.
  - **Kein Datei-Import:** Formulare werden von Hand ausgefüllt. Übernehmen lassen sich nur Stammdaten, die im Portal selbst liegen: Firmen-Basisdaten immer, weitere Firmen- und Mitarbeiterstammdaten mit aktiviertem Online-Speicher, über den Stammdaten-Assistenten im Formular (Benutzerhandbuch, Kap. 3.2; Fragen und Antworten 7.7). Eine Schnittstelle für andere Programme gibt es nicht, und automatisches Befüllen ist verboten: „Das SV-Meldeportal darf ausschließlich und ohne jede Ausnahme nur händisch mit Daten gefüllt werden. Das Einbringen von Daten durch dritte Programme, zum Beispiel durch ein automatisches Befüllen der Onlineformulare, ist strikt untersagt“, als Vorgabe des DEÜV-Verfahrens (Fragen und Antworten 9.7). Die Ausfüllliste bleibt deshalb der Weg; eine Datei zum Hochladen kann Haben nicht erzeugen.
- **Empfohlene Variante:** Haben rechnet, bucht, sendet LStA und LStB über ERiC und erzeugt für das SV-Meldeportal eine **Ausfüllliste** (Beitragsnachweis je Kasse, DEÜV-Felder je Person). Minijobs gehen genauso an die Minijob-Zentrale über das Portal. Der Gesellschafter-Geschäftsführer ohne SV-Pflicht ist der einfachste Fall und kommt zuerst.

## Vorgehen (Vorschlag)

- **Nur sichere Fälle rechnen.** Was Haben nicht sicher kann, meldet es als „nicht unterstützt“ und rechnet es nicht still falsch; der Lohn kommt dann wie bisher als manuelle Buchung aus einem Lohnprogramm.
- **Stufen nach Risiko:** A) Gesellschafter-Geschäftsführer ohne SV-Pflicht (nur Lohnsteuer), B) Minijob, C) Angestellte mit Sozialversicherung erst, wenn ein echter Fall gegen ein Lohnprogramm oder die Steuerberatung gegengerechnet ist; bis dahin als Entwurf gekennzeichnet.
- **Sozialversicherung dauerhaft als Ausfüllliste** für das SV-Meldeportal, keine eigene ITSG-Zertifizierung: Pilotphase, laufende Prüfung und Haftung passen nicht zu einem Open-Source-Projekt ohne Firma dahinter.
- **Jahreswerte von Tests erzwungen:** Lohnsteuer aus dem PAP-XML erzeugt und gegen die amtlichen Prüffälle getestet; SV-Werte als Tabelle je Jahr mit Quelle. Ohne Werte für ein Jahr sperrt Haben die Abrechnung, statt mit Vorjahreswerten zu rechnen. Ein CI-Test schlägt ab Dezember fehl, wenn die Werte für das nächste Jahr fehlen.
- **Zunächst ausgeschlossen:** Sachbezüge, Dienstwagen, Betriebsrente, Kurzarbeit, Pfändungen, Mehrfachbeschäftigung, Steuerklasse VI.
- **ELStAM** zunächst von Hand aus dem ELSTER-Portal eintragen; Abruf über ERiC später prüfen.

## Pull Requests

### PR 1 – Lohnsteuer nach PAP (packages/core)

- **Umfang:** `packages/core/src/lohnsteuer/` mit dem PAP 2026 als TypeScript. Eingaben wie im PAP (RE4, LZZ, STKL, ZKF, KRV, PKV, PVZ, PVA, R …), Ausgaben LSTLZZ, SOLZLZZ, BK. Kirchensteuer 8 % oder 9 % nach Bundesland aus `steuernummer.ts`.
- **Weg:** Code aus dem amtlichen PAP-XML (`bmf-steuerrechner.de/javax.faces.resource/daten/xmls/Lohnsteuer2026.xml.xhtml`) übertragen, einmal pro Jahr. **LstGen** erzeugt aus dem XML PHP, Python, Java, JavaScript und Go, aber kein TypeScript; die JavaScript-Ausgabe taugt als Vorlage, wenn die Lizenz am Repo geprüft ist. Ergebnis in Cents, ohne Floats; der PAP rechnet mit BigDecimal, also eine kleine Dezimal-Hilfe statt `number`.
- **Abgrenzung:** `income-tax.ts` bleibt die Steuerprognose. Die Tarifwerte dort und im PAP gegenseitig per Test abgleichen.
- **Tests:** Prüffälle gegen den BMF-Steuerrechner (Steuerklassen I–V, mit und ohne Kinder, PKV, GGF ohne RV-Pflicht). Querprobe mit `lohnsteuer-bmf` (MIT), das schon Referenz der Prognose ist.

### PR 2 – SV-Beiträge (packages/core)

**Erledigt:** `sozialversicherung()` in `packages/core/src/sozialversicherung/` rechnet die Anteile je Monat für 2026, die Werte stehen mit Quelle je Wert in `werte.ts`, die Jahressperre teilt sich `jahressperre.ts` mit der Lohnsteuer ([Entwicklung](entwicklung.md#sozialversicherung-werte-jährlich-aktualisieren)). Abweichungen vom Plan: Die Beitragsgruppenschlüssel kommen erst mit der Ausfüllliste (PR 6). Im Übergangsbereich lehnt Haben die Pflegeversicherung in Sachsen als „nicht unterstützt“ ab: § 2 Abs. 2 BVV regelt dafür keine Aufteilung, und § 58 Abs. 5 SGB XI lässt sie offen. Ebenso abgelehnt: Mehrfachbeschäftigung, kurzfristige Beschäftigung, Auszubildende, Minijobs im Privathaushalt, Einmalzahlungen und Teilmonate.

- **Umfang:** `packages/core/src/sozialversicherung/`: Rechengrößen je Jahr (BBG KV/PV 5.812,50 €, RV/AV 8.450 € je Monat 2026), Sätze (KV 14,6 % plus Zusatzbeitrag je Kasse, PV 3,6 % mit Kinderlosenzuschlag und Kinderabschlägen, Sonderfall Sachsen, RV 18,6 %, AV 2,6 %), Umlagen U1/U2 je Kasse, Insolvenzgeldumlage 0,15 % (2026). Amtlich belegt: die Grenzen (SV-Rechengrößenverordnung 2026, §§ 2 und 4), KV 14,6 % (§ 241 SGB V) und AV 2,6 % (§ 341 Abs. 2 SGB III). § 55 Abs. 1 SGB XI nennt für die PV noch 3,4 %; die 3,6 % kommen aus einer Verordnung nach Satz 2 und sind wie RV 18,6 % und die Insolvenzgeldumlage am Original zu prüfen.
- **Personengruppen:** sozialversicherungspflichtig (101), Minijob (109: 13 % KV, 15 % RV pauschal, 3,6 % RV-Anteil des AN ohne Befreiung, 2 % Pauschsteuer); dazu die Beitragsgruppenschlüssel je Person, bei Minijobs je nach RV-Befreiung und Krankenversicherung unterschiedlich (Schlüssel aus dem Gemeinsamen Rundschreiben übernehmen, prüfen), Midijob mit Übergangsbereich 603,01–2.000 € und Faktor F 0,6619 (Formel § 20 Abs. 2a SGB IV, getrennte Bemessung für AN-Anteil), GGF ohne SV.
- **Pflege:** Zusatzbeitrag und U1/U2 trägt der Nutzer je Krankenkasse ein. Die bundesweiten Werte stehen als Tabelle im Code mit Quelle, wie `TARIFE` in `income-tax.ts`.
- **Tests:** Beispielrechnungen aus Beratungsblättern der Kassen und der Minijob-Zentrale; Grenzfälle an BBG und Übergangsbereich.

### PR 3 – Mitarbeiter und Lohnabrechnung (apps/web)

**Erledigt:** Tabellen `employees`, `payroll_runs`, `payslips` und `payslip_cancellations` (englische Namen wie die übrigen Tabellen), Modul `apps/web/src/server/modules/lohn/`, Seite **Personal › Lohn** ([Lohn](lohn.md)). Gerechnet wird in `lohnabrechnung()` in `packages/core/src/lohnabrechnung/` nur mit `lohnsteuer`, `lohnkirchensteuer` und `sozialversicherung`. Abweichungen vom Plan:

- **Regelmäßiges Entgelt:** Die Abrechnung gibt das Monatsgehalt der Stammdaten als `regelmaessigesEntgelt` an `sozialversicherung()`. Liegt das Entgelt des Monats in einem anderen Bereich (bis 603 €, Übergangsbereich, darüber), rechnet Haben nicht („nicht unterstützt“); die Bemessung nach § 2 Abs. 2 Satz 2 und 5 BVV bleibt offen, bis ein Rechenbeispiel sie belegt.
- **Stufe C** (Beschäftigte mit SV) rechnet Haben, schreibt sie aber erst fest, wenn der Nutzer bestätigt, dass er sie gegengeprüft hat; die Spalte `gegengeprueft` hält das fest. Privat versicherte Beschäftigte und der Zuschuss zur PKV des Geschäftsführers sind nicht unterstützt.
- **Nur ganze Monate:** Eintritt oder Austritt im Monat ist nicht unterstützt (anteilige BBG, Lohnsteuer nach Kalendertagen).
- **Festschreiben** setzt voraus, dass alle Angaben für die Entgeltbescheinigung da sind (§ 1 Abs. 1 EntgBV) und die Stammdaten seit dem Entwurf unverändert sind. Ein Storno legt gleich den Entwurf der neuen Abrechnung an.
- **Entgeltabrechnung** nach § 108 GewO und § 1 EntgBV, **Lohnkonto** nach § 41 EStG und § 4 LStDV als PDF und CSV; Entgeltunterlagen nach § 8 BVV und die elektronische Bereitstellung nach § 4 Abs. 2a LStDV (DLS) noch nicht.

- **Umfang:** Tabellen `mitarbeiter` (Steuer-ID, Steuerklasse, Kinderfreibeträge, Konfession, Krankenkasse mit Betriebsnummer, Personengruppe, Beitragsgruppe, Tätigkeitsschlüssel, SV-Nummer, Statusfeststellung) und `lohnabrechnungen` (je Monat, festgeschrieben und versiegelt wie `journal_entries`, Audit-Trigger, Korrektur nur als Storno plus neue Abrechnung).
- **Modul:** `apps/web/src/server/modules/lohn/` mit `index.ts`; Server-Funktionen dünn. Seite **Personal › Lohn** mit Abrechnung als PDF (Typst, wie die Rechnung) nach § 108 GewO.
- **Lohnkonto:** je Mitarbeiter und Jahr die Pflichtangaben aus § 41 EStG und § 4 LStDV; Export als PDF/CSV. Entgeltunterlagen nach § 28f SGB IV und Beitragsverfahrensverordnung.
- **Regelmäßiges Entgelt:** Ein einzelner Monat bis 603 € oder über 2.000 € in einer Beschäftigung, deren regelmäßiges Entgelt woanders liegt, wird nach § 2 Abs. 2 BVV anders bemessen (TK-Beratungsblatt 03/2026, Beispiel 6). Die Beitragsrechnung lehnt Monate bis 603 € bei versicherungspflichtig Beschäftigten bis dahin als „nicht unterstützt“ ab; die Abrechnung muss das regelmäßige Entgelt mitgeben.
- **Tests:** Postgres-Integration (Sperren, Storno), Playwright, Seite in `barrierefreiheit.spec.ts` und `seiten.spec.ts`.

### PR 4 – Buchungen aus dem Lohnjournal

**Erledigt:** `lohnBuchung()` in `packages/core/src/lohn-buchung.ts` bildet den Buchungssatz, das Modul `lohn` (`buchung.ts`) bucht ihn beim Festschreiben in derselben Transaktion und beim Storno die Gegenbuchung (Herkunft „Lohn“). Die Lohnkonten sind ein Nebenbuch „Lohn“ in `ledgerManagedAccounts`; neue Bankzuordnungen „Lohn/Gehalt an Mitarbeiter“, „Lohnsteuer an das Finanzamt“ und „SV-Beiträge an Krankenkasse oder Minijob-Zentrale“; im Einzelunternehmen zählen sie in der EÜR als Ausgaben für Personal (Anlage EÜR E6001801). Posten in `hgb.ts` (schon vorhanden, jetzt per Test belegt) und `ebilanz.ts` ([Lohn](lohn.md#buchung), [Buchhaltung](buchhaltung.md#lohnabrechnung)). Abweichungen vom Plan:

- **Minijob-Konten:** Der DATEV-Kontenrahmen 2026 hat eigene Konten für Minijobs: SKR03 4195 / SKR04 6035 „Löhne für Minijobs“, 4194 / 6036 „Pauschale Steuer für Minijobber“, 4144 / 6171 „Soziale Abgaben für Minijobber“. Haben nimmt sie statt 4190 / 6030 „Aushilfslöhne“ und 4199 / 6040 „Pauschale Steuer für Aushilfen“; die E-Bilanz fragt Löhne für Minijobs als Mussfeld getrennt ab. Ihre AG-Pauschalen gehen nicht auf 4130 / 6110.
- **Pauschsteuer im Minijob** steht mit den Beiträgen auf 1742 / 3740, nicht auf 1741 / 3730: Sie wird mit den Beiträgen an die Minijob-Zentrale gezahlt (§ 40a Abs. 6 EStG).
- **Buchungsdatum** ist der letzte Tag des abgerechneten Monats (Lohnzahlungszeitraum, § 38a Abs. 1 Satz 2 EStG), nicht der Zahltag. Die Gegenbuchung steht am selben Tag; der Tag des Stornos steht im Buchungstext.
- **Nicht buchbar, also nicht festschreibbar:** ein Gesellschafter-Geschäftsführer im Einzelunternehmen (den gibt es dort nicht; der Lohn des Inhabers ist eine Entnahme), eine Auszahlung über das Netto hinaus (Zuschuss zur privaten Krankenversicherung), eine Abrechnung in einem abgeschlossenen Jahr.
- **EÜR nach Zahlung, nicht aus der Abrechnung:** Quelle sind die drei Bankzuordnungen am Tag der Zahlung (§ 11 Abs. 2 Satz 1 EStG). Zahlungen zwischen 22. Dezember und 10. Januar ordnet Haben nicht nach § 11 Abs. 2 Satz 2 EStG um, weil es nicht weiß, welchem Monat sie gelten; die Jahreserklärung weist auf sie hin. Lohnzahlungen lassen sich erst zuordnen, wenn eine Abrechnung festgeschrieben ist, damit keine Entnahme des Inhabers als Personalausgabe zählt.
- **Eröffnung:** Die Lohnverbindlichkeiten (1740–1742 / 3720–3740) sind in der Eröffnung von Hand erlaubt, etwa die Lohnsteuer für Dezember aus der bisherigen Buchhaltung; der Lohnaufwand nicht.
- **Berufsgenossenschaft** (4138 / 6120) bucht die Lohnabrechnung nicht: Der Beitrag kommt jährlich per Bescheid und läuft wie bisher als Beleg.
- **Altbestand:** Vor PR 4 festgeschriebene Abrechnungen lassen sich mit „Jetzt buchen“ nachbuchen; ihr Storno hat nichts gegenzubuchen.
- **E-Bilanz:** Gehälter auf „Löhne und Gehälter, übrige“, Geschäftsführer und Minijobs auf ihre Mussfelder, AG-Anteile auf „soziale Abgaben“ (`socExp.other`), Verbindlichkeiten auf die Davon-Positionen gegenüber Arbeitnehmern, aus Steuern und im Rahmen der sozialen Sicherheit. Die Bezeichnungen der Taxonomie-Positionen sind aus dem Namen erschlossen, nicht aus der Label-Datei (esteuer.de war nicht erreichbar); mit der Steuerberatung prüfen.

- **Umfang:** `packages/core/src/lohn-buchung.ts` erzeugt je Abrechnung eine Buchung; ein Nebenbuch „Lohn“ sperrt die Lohnkonten für manuelle Buchungen (`manual.ts`, `ledgerManagedAccounts`).
- **Konten (DATEV-Kontenrahmen SKR 03 und SKR 04, gültig für 2026, Art.-Nr. 11174 und 11175; am Original geprüft):**

| Vorgang | SKR03 | SKR04 |
| --- | --- | --- |
| Gehälter | 4120 | 6020 |
| Geschäftsführergehälter GmbH-Gesellschafter | 4124 | 6024 |
| Aushilfslöhne (Minijob) | 4190 | 6030 |
| Pauschale Steuer Aushilfen | 4199 | 6040 |
| Gesetzliche soziale Aufwendungen (AG-Anteil, Umlagen) | 4130 | 6110 |
| Beiträge Berufsgenossenschaft | 4138 | 6120 |
| Verbindlichkeiten aus Lohn und Gehalt | 1740 | 3720 |
| Verbindlichkeiten Lohn- und Kirchensteuer | 1741 | 3730 |
| Verbindlichkeiten soziale Sicherheit | 1742 | 3740 |

- **Buchung:** Aufwand brutto und AG-Anteil an 1740/1741/1742. Bank: neue Zuordnungen „Lohn/Gehalt“, „Lohnsteuer an Finanzamt“, „SV-Beiträge an Krankenkasse“. Vorsicht: SKR03 3730 ist in Haben „Erhaltene Skonti“, nicht verwechseln.
- **Einzelunternehmen:** Dort gibt es keine manuellen Buchungen, und die Anlage EÜR rechnet aus Rechnungen, Belegen und Zahlungen, nicht aus dem Journal (siehe [Buchhaltung](buchhaltung.md)). Eine Lohnbuchung allein käme dort nicht an; der Lohn muss als eigene Quelle in die EÜR einfließen (Zeile Löhne und Gehälter, Zufluss-/Abflussprinzip). Das ist Teil dieses PR.
- **Folgen:** Posten in `hgb.ts` (Personalaufwand, sonstige Verbindlichkeiten) und `ebilanz.ts` für 1740–1742/3720–3740.
- **Tests:** SKR03 und SKR04, Ist und Soll, GmbH und Einzelunternehmen.

### PR 5 – Lohnsteuer-Anmeldung über ERiC

- **Umfang:** `packages/elster/src/lsta.ts` nach dem Muster von `kapesta.ts` und `elsterXml` (Verfahren ElsterAnmeldung, Datenart LStA). Kennzahlen und Reihenfolge aus Schema und Jahresdokumentation LStA_2026 im ERiC-Paket. Anmeldezeitraum nach § 41a EStG (monatlich, vierteljährlich, jährlich nach der Vorjahressteuer). Frist am 10. in `fristen.ts`. Berichtigte Anmeldung.
- **Ohne Hersteller-ID:** Ausfüllliste für Mein ELSTER, wie bei den anderen Formularen.
- **Tests:** XML gegen Schema, echter ERiC mit Testmerker (wie `eric-kapesta.test.ts`).

### PR 6 – Ausfüllliste für SV-Meldeportal und Minijob-Zentrale

- **Umfang:** je Monat und Krankenkasse die Werte des Beitragsnachweises (Beitragsgruppen 1000/3000/0100/0010/0001, Umlagen, Insolvenzgeld); je Person die DEÜV-Felder für Anmeldung (10), Abmeldung (30), Jahresmeldung (50), Sofortmeldung. Fristen: Beitragsnachweis zwei Arbeitstage vor dem drittletzten Bankarbeitstag; in `fristen.ts`.
- **Vermerk:** Der Nutzer trägt „im Portal abgegeben“ mit Datum ein; das Protokoll aus dem Portal hängt er an.
- **Hinweis in der UI:** Haben übermittelt nicht an die Sozialversicherung.
- **Kein Import, kein Automatisieren:** Das Portal kennt keinen Datei-Import und verbietet automatisches Befüllen (Fragen und Antworten 9.7). Haben erzeugt deshalb weder eine Importdatei noch ein Skript, eine Browsererweiterung oder Zwischenablage-Makros, die Formulare füllen. Die Liste folgt der Reihenfolge der Formularabschnitte im Portal (Beitragsnachweis: Kapitel 4.2, SV-Meldungen mit Meldegrund: Kapitel 4.1 des Benutzerhandbuchs), damit das Abtippen Feld für Feld geht.
- **Stammdaten einmal im Portal:** Die Ausfüllliste empfiehlt, den Online-Speicher zu aktivieren und Firma und Mitarbeiter einmal dort anzulegen; danach holt der Stammdaten-Assistent Name, Anschrift und Versicherungsnummer ins Formular, und die Liste braucht je Monat nur die Bewegungsdaten (Entgelt, Beiträge je Beitragsgruppe, Zeitraum).

### PR 7 – Lohnsteuerbescheinigung und ELStAM

- **LStB:** `packages/elster/src/lstb.ts` (Verfahren ElsterLohn, Datenart LStB) bis zum letzten Tag im Februar des Folgejahres, mit eTIN/Steuer-ID. Schema aus dem ERiC-Paket.
- **ELStAM:** An- und Abmeldung und Abruf über ERiC (ElsterLohn2, prüfen) mit Organisationszertifikat. Erst nach Klärung der Herstellerfrage. Bis dahin trägt der Nutzer die Merkmale von Hand ein.

## Gesellschafter-Geschäftsführer

- **SV-frei**, wenn er mindestens 50 % des Kapitals hält oder eine echte, umfassende Sperrminorität hat (BSG, B 12 R 5/16 R; B 12 R 1/19 R; B 12 R 19/19 R). Eine Sperrminorität nur im Anstellungsvertrag reicht nicht.
- **Statusfeststellung:** Die Anmeldung eines GmbH-Gesellschafter-Geschäftsführers mit Statuskennzeichen 2 löst eine Prüfung durch die Clearingstelle der DRV Bund aus: Ergibt sich aus der Meldung, dass der Beschäftigte geschäftsführender Gesellschafter einer GmbH ist, stellt die Einzugsstelle den Antrag auf Statusfeststellung (§ 7a Abs. 1 Satz 2 SGB IV); das Statuskennzeichen 2 als Merkmal dafür in der Meldung ist zu prüfen. Stellt sie Versicherungsfreiheit fest, fallen keine Beiträge und keine Beitragsnachweise an; welche DEÜV-Meldungen danach noch nötig sind, ist zu prüfen.
- **Trotzdem:** Lohnsteuer-Anmeldung, LStB, ELStAM, Lohnkonto. Im PAP ohne RV-Pflicht (KRV), meist privat versichert (PKV, AG-Zuschuss nur, wenn vereinbart; steuerpflichtig, wenn kein § 3 Nr. 62 EStG greift). Unfallversicherung nach Satzung der Berufsgenossenschaft. Keine Insolvenzgeldumlage.

## Pflichten einer Lohnsoftware

- Lohnkonto je Arbeitnehmer und Kalenderjahr (§ 41 Abs. 1 EStG, Einzelangaben in § 4 LStDV), aufbewahren bis zum Ablauf des sechsten Kalenderjahres, das auf die zuletzt eingetragene Lohnzahlung folgt (§ 41 Abs. 1 Satz 9 EStG).
- Entgeltunterlagen elektronisch (§ 28f SGB IV, § 8 BVV), aufbewahren bis Ende des Jahres nach der letzten Betriebsprüfung.
- Entgeltabrechnung in Textform (§ 108 GewO).
- GoBD: festgeschrieben, versiegelt, Korrektur nur als Storno; passt zu Haben.
- Nicht in Haben: elektronischer Lohnnachweis an die Berufsgenossenschaft, eAU-Abruf, A1, euBP. Alles über das SV-Meldeportal oder das BG-Portal.

## Risiken und offene Fragen (Betreiber)

1. **Haftung:** Falsche Abzüge haften beim Arbeitgeber (§ 42d EStG, § 28e SGB IV). Will Haben das anbieten, oder nur für GGF ohne SV?
2. **SV-Umfang:** Nur Ausfüllliste (empfohlen) oder später ITSG-Systemprüfung? Kosten nicht öffentlich gefunden; Anfrage bei der ITSG nötig.
3. **ELStAM:** Braucht die Hersteller-ID eine Freischaltung für ElsterLohn2? Frage im ELSTER-Entwicklerforum.
4. **Jährliche Pflege:** PAP (meist November), Rechengrößen, Minijob-Grenze, Faktor F, Zusatzbeiträge. Wer pflegt das, und sperrt Haben ein Jahr ohne Werte?
5. **Abgrenzung:** keine Sachbezüge, Dienstwagen, bAV, Kurzarbeit, Mehrfachbeschäftigung, Baulohn im ersten Schritt?
6. **Kosten für Nutzer:** SV-Meldeportal 36 € zuzüglich Umsatzsteuer für drei Jahre (99 € mit mehreren Betriebsnummern); ELSTER-Organisationszertifikat nötig, ausnahmsweise BundID (am Portal belegt, siehe Kurzfazit).
7. **Rechtsstand:** Der Pauschalbeitrag KV für Minijobs soll ab 2027 steigen; Werte vor dem Release prüfen.

## Quellen

- PAP 2026, BMF-Schreiben 12.11.2025: https://www.ihk-muenchen.de/ihk/documents/Recht-Steuern/Steuerrecht/Einkommensteuer/2025-11-12-PAP-2026-anlage-1.pdf
- PAP-XML: https://www.bmf-steuerrechner.de/javax.faces.resource/daten/xmls/Lohnsteuer2026.xml.xhtml
- LstGen (PAP → PHP, Python, Java, JavaScript, Go; Lizenz am Repo prüfen): https://github.com/jenner/LstGen
- lohnsteuer-bmf (MIT): https://github.com/L1nch-lab/lohnsteuer-bmf
- Weitere: https://github.com/MarcelLehmann/Lohnsteuer (Apache-2.0), https://github.com/canida-software/lohnsteuer (MIT), https://github.com/taxcalcs/taxjs (MIT)
- § 95b SGB IV: https://www.gesetze-im-internet.de/sgb_4/__95b.html; Herkunft aus § 28a Abs. 1 Satz 2 und 3 laut Änderungshistorie: https://www.buzer.de/95b_SGB_IV.htm
- § 7a SGB IV: https://www.gesetze-im-internet.de/sgb_4/__7a.html; § 41 EStG: https://www.gesetze-im-internet.de/estg/__41.html
- Systemprüfung: https://www.informationsportal.de/aok-hessen/sv-bibliothek/meldeverfahren/gemeinsame-meldeverfahren/sonstige-themen-3/systemuntersuchung/
- Gemeinsame Grundsätze § 22 DEÜV: https://files.viactiv.de/uploads/sites/11/25_06_15_GG_22_DEUEV.pdf
- sv.net abgeschaltet: https://www.tk.de/firmenkunden/versicherung/meldeverfahren-faq/faq-sv-meldeportal/sv-net-wird-abgeschaltet-2154774 (30.06.2024), https://www.tk.de/firmenkunden/versicherung/meldeverfahren-faq/faq-sv-meldeportal/sv-net-ist-abgeschaltet-2155552; verschobener Termin 29.02.2024: https://www.deutsche-rentenversicherung.de/DRV/DE/Ueber-uns-und-Presse/Presse/Meldungen/2024/240322-sv-meldeportal-schon-umgestiegen.html
- SV-Meldeportal, Start, Kosten und dass es nicht rechnet: https://www.tk.de/firmenkunden/versicherung/meldeverfahren-faq/faq-sv-meldeportal/was-kostet-sv-meldeportal-2154136, https://www.tk.de/firmenkunden/versicherung/meldeverfahren-faq/faq-sv-meldeportal/varianten-im-sv-meldeportal-2155412, https://www.tk.de/firmenkunden/versicherung/meldeverfahren-faq/faq-sv-meldeportal/was-ist-das-sv-meldeportal-2154134
- SV-Meldeportal, Primärquellen: Benutzerhandbuch (Stand 01.12.2025) https://info.sv-meldeportal.de/wp-content/uploads/de-benutzerhandbuch.pdf, Fragen und Antworten https://info.sv-meldeportal.de/fragen-antworten/, Registrierung und Preise https://info.sv-meldeportal.de/registrierung/, Einführung https://info.sv-meldeportal.de/einfuehrung, Flyer https://info.sv-meldeportal.de/wp-content/uploads/Flyer_SVMeldeportal_05_08_24.pdf
- SV-Meldeportal, weitere: https://www.barmer.de/firmenkunden/sozialversicherung/sozialversicherungswissen/meldungen-sozialversicherung/sv-meldeportal-1143484, https://www.tk.de/resource/blob/2157898/7fdcc5766678c59178a71c281bb963cf/beratungsblatt-sv-meldeportal-data.pdf, https://arbeitgeber.de/wp-content/uploads/bda-arbeitgeber-faq-fragen_und_antworten_zur_nutzung_des_SVMeldeportals-2025-09-08.pdf
- Rechengrößen 2026, amtlich: Sozialversicherungs-Rechengrößenverordnung 2026, https://www.gesetze-im-internet.de/svbezgrv_2026/ (§ 2 Abs. 2 BBG KV/PV 69.750 €, § 4 Abs. 1 BBG RV/AV 101.400 €); Beitragssätze KV https://www.gesetze-im-internet.de/sgb_5/__241.html, AV https://www.gesetze-im-internet.de/sgb_3/__341.html
- Rechengrößen 2026, weitere: https://www.deutsche-rentenversicherung.de/DRV/DE/Ueber-uns-und-Presse/Presse/Meldungen/2025/250910-sv-rechengroessen-vo-2026.html, https://www.tk.de/firmenkunden/service/fachthemen/fachthema-beitraege/sozialversicherungs-rechengroessen-2026-2203234
- Übergangsbereich: https://www.tk.de/resource/blob/2031420/c5924456e673ed942a4be369a4ad070f/beratungsblatt-beschaeftigung-im-uebergangs-midijobbereich-data.pdf
- Insolvenzgeldumlage 2026: https://www.tk.de/firmenkunden/versicherung/beitraege-faq-und-mehr/zahlen-und-grenzwerte/insolvenzgeldumlage-2047584
- Minijob: https://www.aok.de/fk/nordwest/tools/weitere-inhalte/beitraege-und-rechengroessen-der-sozialversicherung/beitraege-fuer-minijobs/
- Statusfeststellung GGF: https://www.tk.de/firmenkunden/service/fachthemen/versicherung-fachthema/statusfeststellungsverfahren-2047006, BSG B 12 R 19/19 R: https://rewis.io/urteile/urteil/jsm-01-02-2022-b-12-r-1919-r/
- ELStAM: https://www.elster.de/elsterweb/infoseite/elstam_(arbeitgeber), BMF-Schreiben 13.12.2024: https://elster.de/elsterweb/attachments/elstam_(arbeitgeber)/2024-12-13-ELStAM-elektr-lohnsteuerabzugsmerkmale.pdf
- ELSTER-Entwickler: https://www.elster.de/eportal/infoseite/entwickler
- Konten: DATEV-Kontenrahmen 2026 SKR 03 https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11174%20SKR03%20BilrUg.pdf und SKR 04 https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11175%20SKR04%20BilrUg.pdf; Übersicht bei Lexware: https://help.lexware.de/de-form/articles/548092-kontentabellen-der-lohnbuchungsmaske
