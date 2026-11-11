---
title: "Buchungslogik: Konten, Buchungssätze und GoBD"
description: >-
  Wie Haben bucht: Konten nach SKR03 und SKR04, Buchungssätze je Vorgang, doppelte Buchführung im
  Hintergrund und die GoBD-Unveränderbarkeit per Hash-Kette.
---

# Buchhaltung in Haben (Buchungslogik)

Diese Seite beschreibt, wie Haben bucht: welche Konten es verwendet, welcher Vorgang welchen Buchungssatz erzeugt und wie die Unveränderbarkeit nach GoBD technisch abgesichert ist. Sie richtet sich an Nutzer, die ihre Buchungen nachvollziehen wollen, und an Steuerberatungen.

## Grundsätze

- **Beträge in Cent.** Alle Geldbeträge sind ganze Cent (`integer`), Steuersätze Basispunkte (1900 = 19 %). Es gibt keine Gleitkommarechnung mit Geld. Rechnungen runden die Steuer je Steuersatz auf die Summe der Positionen, nicht je Position.
- **Doppelte Buchführung im Hintergrund.** Jeder buchungsrelevante Vorgang erzeugt eine Buchung (`journal_entries`) mit mindestens zwei Zeilen (`journal_lines`), je Zeile Konto, Soll oder Haben und Steuerschlüssel. Die Auswertungen und die Voranmeldung rechnet Haben aus den zugrunde liegenden Rechnungen, Zahlungen und Belegen; das Journal dokumentiert dieselben Vorgänge in Kontenform. Ein [Abgleich](#abgleich-von-journal-umsatzsteuer-und-eür) prüft, dass beides übereinstimmt.
- **Festschreibung ab Entstehung.** Eine Buchung wird in derselben Datenbanktransaktion angelegt und festgeschrieben, in der der Vorgang passiert. Geschrieben wird das Journal nur an einer Stelle, dem Hauptbuch (`ledger.post` in `apps/web/src/server/modules/buchhaltung/ledger.ts`). Beim Festschreiben prüft ein Trigger, dass Soll gleich Haben ist und die Buchung mindestens eine Zeile hat; eine Buchung, die beim Commit nicht festgeschrieben ist, lehnt die Datenbank ab.
- **Korrektur nur per Gegenbuchung.** Festgeschriebene Buchungen, Rechnungen, Belege und gesendete Voranmeldungen lassen sich nicht ändern oder löschen. Eine Rechnung wird storniert oder korrigiert, eine Zahlungszuordnung per Gegenzeile und Gegenbuchung aufgehoben, eine Voranmeldung berichtigt.
- **Ein Kontenrahmen je Buchung.** Jede Buchung speichert den Kontenrahmen, mit dem sie entstanden ist, und das ist immer der aus den Firmendaten (die Datenbank prüft das beim Einfügen). Ein Wechsel des Kontenrahmens in den Einstellungen gilt nur für künftige Buchungen und ist nur möglich, solange es im laufenden Jahr noch keine Buchung gibt; bei GmbH und UG nur vor der ersten Buchung überhaupt.

## GoBD: Unveränderbarkeit in der Datenbank

Die Sperren stecken nicht nur im Anwendungscode, sondern als Trigger in Postgres (`apps/web/drizzle/0001_festschreibung.sql` und folgende `*_trigger.sql`). Sie greifen also auch bei SQL von Hand, etwa mit `psql`. Gegen Absicht schützen sie nicht: Wer als Eigentümer der Tabellen verbunden ist, wie die App selbst, kann Trigger abschalten. Bei einer selbst gehosteten Installation hat der Betreiber ohnehin vollen Zugriff auf den Server; die Trigger verhindern Versehen und Programmfehler.

| Art | Tabellen | Wirkung |
| --- | --- | --- |
| Festschreibung | `journal_entries`, `invoices`, `documents`, `vat_returns` | `UPDATE` und `DELETE` werden abgelehnt, sobald `locked_at` gesetzt ist |
| Abhängige Zeilen | `journal_lines`, `invoice_lines`, `invoice_taxes`, `quote_lines`, `document_amounts` | Einfügen, Ändern und Löschen abgelehnt, wenn die Buchung, Rechnung bzw. der Beleg festgeschrieben ist; auch das Umhängen einer Zeile aus einer festgeschriebenen Buchung oder in sie hinein |
| Nur anhängen | `audit_log`, `seals`, `vat_return_submissions`, `contact_versions`, `bank_imports`, `bank_transactions`, `allocations`, `archive_files`, `datev_bookings`, `lexoffice_vouchers`, `lexoffice_voucher_files`, `asset_depreciations`, `pauschalen`, `cash_entries` | `UPDATE` und `DELETE` immer abgelehnt |
| Kontakte | `contacts` | Löschen abgelehnt; jede Änderung erhöht die Version und legt eine Kopie in `contact_versions` ab |
| Angebote | `quotes` | Nach dem Festschreiben nur noch Antwort des Kunden und Verweis auf die Rechnung änderbar, Löschen abgelehnt |
| Nummernkreis | `invoice_number_counters`, `quote_number_counters` | Zähler darf nicht sinken, Zeilen nicht gelöscht werden |
| Anlagen | `assets` | Sobald AfA oder Eröffnung gebucht ist, sind Art, Abschreibung, Konto, Datum, Kosten, Nutzungsdauer, degressiver Satz, Erinnerungswert und Übernahmewerte fest; der Wechsel von degressiver zu linearer AfA nur in ein noch nicht gebuchtes Jahr; Löschen nur ohne Buchung und ohne Beleg |
| Zuordnungen | `allocations` | Vorzeichen muss dem Bankumsatz entsprechen, die Summe darf den Umsatz nicht übersteigen |
| Hauptbuch | `journal_entries` | Eine Buchung ist beim Commit festgeschrieben, sonst wird die Transaktion abgelehnt; ihr Kontenrahmen ist der aus den Firmendaten (`0065_hauptbuch_sperren.sql`) |
| Firmendaten | `company` | Kontenrahmen, Versteuerung und das Einschalten von § 19 UStG werden abgelehnt, sobald im laufenden Jahr (deutsche Zeit) gebucht ist; die Rechtsform, sobald es überhaupt eine Buchung gibt (`0096_rechtsform_trigger.sql`), bei GmbH und UG ebenso der Kontenrahmen (`0101_kontenrahmen_kapg.sql`). Diese Sperren vergleichen bei `UPDATE` alten und neuen Wert; damit Löschen und neu Anlegen der Zeile nicht an ihnen vorbeigeht, ist `DELETE` ab der ersten Buchung abgelehnt (`0202_company_loeschen_sperre.sql`). Nicht abgedeckt ist, wer die Zeile vor der ersten Buchung löscht, an Haben vorbei per SQL bucht und sie danach neu anlegt; Haben selbst legt die Firmendaten vor jeder Buchung an |
| Leeren | jede Tabelle, deren Zeilen ein Trigger gegen Löschen schützt (alle oben, alle versiegelten und alle, die nur anhängen), und jede, deren Löschen das Änderungsprotokoll aufzeichnet (etwa `company`, `vat_frequencies`, `user`); `apps/web/src/server/db/truncate.test.ts` prüft die Liste am Katalog | `TRUNCATE` abgelehnt, auch als `CASCADE` von einer anderen Tabelle aus. Zeilen-Trigger feuern bei `TRUNCATE` nicht; deshalb hat jede dieser Tabellen einen eigenen Trigger vor `TRUNCATE` (`0201_truncate_sperre_trigger.sql`, für `audit_log`, `seals` und `audit_chain` schon `0001` und `0063`; `external_imports` nur, solange sie Zeilen hat, `0198`) |

### Änderungsprotokoll

Trigger schreiben jede Änderung an den wichtigen Tabellen mit altem und neuem Wert als JSON in `audit_log`: Firmendaten, Zertifikate, Voranmeldungen und Übermittlungen, Kontakte, Rechnungen, Buchungen, Nummernkreis, Belege, Bankkonten, Importe, Zuordnungen, Archivdateien, Lexoffice-Abrufe und -Verbindung. Weggelassen werden Binärdaten und große Nachrichten, die unveränderlich in ihrer eigenen Tabelle stehen, sowie verschlüsselte Inhalte, nämlich die Spalten `pdf`, `protocol_pdf`, `xml`, `logo`, `request_xml`, `response_xml`, `server_response_xml`, `abholung` (VaSt), `ciphertext` und `pin_ciphertext`. Bei Tabellen ohne `id` (Nummernkreise, Angaben zur Einkommensteuer) steht das Jahr als Zeilenkennung im Protokoll.

Jede schreibende Aktion läuft in einer Transaktion, die vorher `haben.actor` auf die ID des angemeldeten Nutzers setzt (`withActor` in `apps/web/src/server/db/actor.ts`). Der Trigger übernimmt diesen Wert in die Spalte `actor`. So ist jede Änderung einer Person zugeordnet.

### Manipulationserkennung: Hash-Kette und Siegel

Die Trigger oben verhindern Versehen, aber wer die Datenbank direkt ändern kann (Betreiber, Wiederherstellung eines Backups), kommt an ihnen vorbei. Damit solche Änderungen auffallen, verkettet Haben das Änderungsprotokoll und versiegelt festgeschriebene Datensätze (`apps/web/drizzle/0063_hash_kette_trigger.sql`).

- **Hash-Kette:** Jeder Eintrag in `audit_log` bekommt eine lückenlose Nummer `seq`, den Hash seines Vorgängers `prev_hash` und seinen eigenen `row_hash` = SHA-256(`prev_hash` ‖ Inhalt). Der Inhalt sind Nummer, Zeitpunkt (UTC), Nutzer, Tabelle, Zeile, Aktion, alter und neuer Wert, so wie sie gespeichert sind. Der Trigger nimmt eine Sperre bis zum Ende der Transaktion; parallele Transaktionen verketten also nacheinander, und die Kette verzweigt nie. Unter `REPEATABLE READ` oder `SERIALIZABLE` lehnt er ab, weil dort der Vorgänger aus einer anderen Transaktion unsichtbar sein könnte (Haben selbst arbeitet immer mit `READ COMMITTED`). Den Kopf der Kette (letzte Nummer und Hash) hält die einzeilige Tabelle `audit_chain`; ein Trigger schreibt ihn beim Commit fort, sonst darf sie niemand ändern. Er zeigt, ob am Ende der Kette Einträge fehlen.
- **Siegel:** Wird eine Buchung, Rechnung, ein Beleg oder eine Voranmeldung festgeschrieben, legt ein Trigger in `seals` einen SHA-256 über den Datensatz und seine abhängigen Zeilen ab: Buchungszeilen, Rechnungspositionen und Steuerbeträge je Satz, bei Rechnungen ab Haben-Migration `0125` auch die [zusätzlichen Anhänge](rechnungen.md#zusätzliche-anhänge) (Dateiname, Größe, SHA-256 der Datei), Beträge des Belegs, bei Voranmeldungen ab `0138` der [Abgabevermerk](umsatzsteuer.md#abgabe-außerhalb-von-haben-vermerken) (Tag, Transferticket, Kz 83, SHA-256 des Protokolls). Das PDF einer Rechnung zählt mit, nicht nur seine Prüfsumme. Diese Zeilen stehen sonst nicht im Audit-Log. Das Siegel merkt sich, über welche Spalten es gebildet ist; Spalten, die eine spätere Version von Haben ergänzt, ändern es nicht. Kassenbuch, Zuordnungen, Pauschalen und AfA sind ohnehin nur anhängbar; jede ihrer Zeilen bekommt ihr Siegel schon beim Anlegen. Betrag, Datum und Konto stecken zusätzlich in der versiegelten Buchung, das Siegel der Zeile schützt auch, was nur dort steht: laufende Nummer, Art und Text im Kassenbuch samt Rechnung und Steueranteil einer Bareinnahme, Rechnung oder Beleg einer Zuordnung, Angaben einer Pauschale (Kilometer, Tage), Abgang und Privatnutzung der AfA. Das Siegel steht selbst als Eintrag in der Kette.
- **Bestand:** Beim Update verkettet die Migration die vorhandenen Einträge in der Reihenfolge ihrer ID und versiegelt alles schon Festgeschriebene (`genesis = true`). Ein Eintrag der Migration im Protokoll weist darauf hin. Für die Zeit davor bezeugt die Kette nichts.

**Prüfen** unter **Einstellungen › Export › Änderungsprotokoll prüfen**: „Kette prüfen“ rechnet jeden Hash und jedes Siegel nach und meldet geänderte, gelöschte oder fehlende Einträge, einen Kopf, der nicht zum Ende passt, festgeschriebene Datensätze ohne oder mit abweichendem Siegel, aufgehobene Festschreibungen und Siegel, die nicht zu ihrem Eintrag in der Kette passen.

**Was die Kette nicht kann:** Sie verhindert keine Änderung, sie macht sie sichtbar. Wer vollen Zugriff hat, kann nach einer Änderung auch die ganze Kette und alle Siegel neu berechnen; dann ist sie in sich wieder stimmig. Das fällt nur mit einem Prüfwert auf, der außerhalb des Servers liegt und zu dem der Eintrag dieser Nummer nicht mehr passt. Deshalb:

- schickt Haben den Prüfwert (`Nr. <seq> · <Hash>`) einmal pro Woche per E-Mail an die Adresse für Erinnerungen, wenn sich etwas geändert hat (abschaltbar unter Einstellungen › E-Mail),
- steht er im Jahresarchiv in `protokoll/pruefwert.txt`.

Ein aufbewahrter Prüfwert lässt sich unter „Änderungsprotokoll prüfen“ einfügen und vergleichen. Haben vergleicht dann den Hash des Eintrags dieser Nummer und rechnet die Kette bis dorthin nach. Stimmt beides, sind die Einträge bis zu dieser Nummer unverändert. Ob die festgeschriebenen Daten noch zu ihren Siegeln passen, zeigt „Kette prüfen“. Fehlt der Eintrag, wurde entweder ein älteres Backup eingespielt oder es wurden Einträge gelöscht. Eine stärkere Absicherung sind schreibgeschützte Backups (z. B. Object Lock) oder später ein qualifizierter Zeitstempel (RFC 3161) auf den Prüfwert.

Die wöchentliche Mail prüft vorher Kette und Siegel und vergleicht den Prüfwert der letzten Mail mit dem Eintrag dieser Nummer. Befunde stehen in der Mail, auch wenn ohne neuen Eintrag manipuliert wurde.

**Nicht abgedeckt** sind direkte Änderungen an Tabellen ohne Siegel: Mahnungen, Übermittlungen an ELSTER, Anlagen (die Stammdaten; ihre AfA ist versiegelt), Kontaktversionen und Angebote. Ihr Anlegen steht in der Kette, eine spätere stille Änderung der Zeile selbst findet die Prüfung aber nicht. Bankumsätze (`bank_transactions`) stehen gar nicht im Audit-Log; ihre Auszugsdatei ist über `bank_imports` mit SHA-256 erfasst.

## Abgleich von Journal, Umsatzsteuer und EÜR

Voranmeldung und EÜR rechnet Haben aus Rechnungen, Belegen, Zuordnungen, Pauschalen und dem Anlagenverzeichnis. Das Journal bucht dieselben Vorgänge getrennt davon. Beides muss übereinstimmen. Ab dem Stichjahr kommen die Kennzahlen der Voranmeldung und die EÜR aus dem Journal ([Wie die Kennzahlen entstehen](umsatzsteuer.md#wie-die-kennzahlen-entstehen), [EÜR](auswertungen.md#eür-nach-zufluss-und-abfluss)); der Abgleich vergleicht dann das Journal mit der Rechnung aus Rechnungen, Belegen und Zahlungen als Gegenprobe. Zahlungen auf aus Lexoffice übernommene Rechnungen und Belege verteilt die EÜR aus dem Journal auf die Zeilen, die Haben für sie gebucht hätte; sie werden wie alle anderen verglichen. Weicht es ab, ist eine der beiden Rechnungen falsch, oder jemand hat Daten an Haben vorbei geändert. Der Abgleich steht in `apps/web/src/server/modules/auswertungen/abgleich.ts`, die Bemessungsgrundlagen in `abgleich-kennzahlen.ts` und die EÜR aus dem Journal in `euer-journal.ts` daneben.

| Bereich | Verglichen wird | Journal |
| --- | --- | --- |
| Voranmeldung, je Monat | Umsatzsteuer 19 % (Kz 81) und 7 % (Kz 86) | Saldo der Konten Umsatzsteuer 19 % und 7 %, ohne die Privatnutzung von Fahrzeugen |
| | Umsatzsteuer nach § 13b (Kz 47, 85) | Saldo des Kontos „Umsatzsteuer nach § 13b“ |
| | Vorsteuer (Kz 66) | Saldo der Vorsteuerkonten 19 % und 7 % |
| | Vorsteuer nach § 13b (Kz 67) | Saldo des Kontos „Abziehbare Vorsteuer nach § 13b“ |
| | Erwerbsteuer (Kz 89, 93) | Saldo der Konten „Umsatzsteuer aus innergemeinschaftlichem Erwerb“ |
| | Vorsteuer aus innergemeinschaftlichem Erwerb (Kz 61) | Saldo der Konten „Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb“ |
| | Bemessungsgrundlagen: Kz 81, 86, 21, 41, 43, 45, 48, 46, 84, 89 und 93; bei Ist-Versteuerung ohne Kz 43 und 48, Kz 81 und 86 nur, wenn jede Zahlung im Zeitraum ihre Bemessungsgrundlage trägt | Erlös- und Aufwandszeilen nach ihrem Steuerschlüssel ([Steuerschlüssel und Kennzahlen](#steuerschlüssel-und-kennzahlen)); bei Ist zählt ein Verkauf auf Ziel erst mit der Zahlung (`packages/core/src/journal-kennzahlen.ts`) |
| EÜR, je Jahr | Pauschalen | Aufwandskonten der Pauschalen |
| | Umsatzsteuer an das Finanzamt abzüglich Erstattungen | Konto Umsatzsteuer-Vorauszahlungen, Sondervorauszahlung und Umsatzsteuer früherer Jahre aus Zuordnungen |
| | Zinsen und Zuschläge zu betrieblichen Steuern | abziehbare Zinsen §§ 233a bis 237 AO, abziehbare andere Nebenleistungen, abziehbare Verspätungszuschläge |
| | Gewerbesteuer und Nebenleistungen darauf (nachrichtlich) | Gewerbesteuer, Gewerbesteuer Vorjahre und die nicht abziehbaren Zinsen und Zuschläge |
| | AfA, GWG, Sammelposten, Restbuchwert | AfA-Konten und Restbuchwert, sobald die AfA des Jahres gebucht ist |
| | Private Kfz-Nutzung und die Umsatzsteuer darauf | Erlöskonten der Privatnutzung und Umsatzsteuer 19 % aus den Buchungen der Anlagen, ebenfalls erst nach der AfA |
| | Nur im Einzelunternehmen (GmbH und UG bilanzieren): Einnahmen (steuerpflichtig, steuerfrei, Kleinunternehmer), vereinnahmte Umsatzsteuer, Vorsteuer, Personal, Ausgaben je Kategorie, nicht abziehbarer Teil der Bewirtung („EÜR: …“) | Buchungen ohne Forderungen und Verbindlichkeiten (Bank, Kasse, privat bezahlt) nach ihren Konten; eine Rechnung bzw. ein Beleg auf Ziel erst mit der Zahlung: Jede Zahlung, Bareinnahme und Kursdifferenz wird anteilig auf die Zeilen der Buchung verteilt, die sie ausgleicht, gerundet wie der beim Zuordnen gespeicherte Anteil: bei einer Rechnung gegen alles bis dahin Erfasste, in der Reihenfolge, in der die Zahlungen gebucht wurden, eine Aufhebung genau umgekehrt; so ergeben alle Raten zusammen genau ihre Steuer. Eine Teilzahlung auf einen Beleg mit Privatanteil oder ohne Vorsteuerabzug rechnet mit den Beträgen des Belegs je Steuersatz bzw. je Zeile der Aufteilung, weil die Buchung den privaten Teil bzw. Netto und Steuer zusammenfasst. Eine Rechnung aus dem Vorjahr wird im Kontenrahmen ihrer Buchung verteilt, eine Gegenbuchung im Kontenrahmen der aufgehobenen Buchung, auch nach einem Wechsel. Skonto und Forderungsausfall wirken nicht. Die Zuordnung Konto → EÜR-Zeile steht in `packages/core/src/journal-euer.ts` |
| | Nur im Einzelunternehmen: Gewinn („EÜR: Gewinn nach der DATEV-Formel“), sobald AfA und Privatnutzung gebucht sind | Gegenprobe nach der DATEV-Formel: negativer Saldo der Erfolgs- und Steuerkonten, Forderungen und Verbindlichkeiten im Jahr, dazu die nicht abziehbaren Beträge. Erlöse und Aufwand stehen dort nach Rechnungs- bzw. Belegdatum, die Veränderung von Forderungen und Verbindlichkeiten macht daraus den Gewinn nach Zahlung. Korrigiert wird der noch offene Anteil von Zeilen außerhalb dieser Konten (Privatanteil, Anlage) am Jahres- und Vorjahresende, bei einem im Voraus bezahlten Beleg der schon bezahlte Anteil. Bei aus Lexoffice übernommenen Rechnungen und Belegen steht der Saldenvortrag für Erlös bzw. Aufwand, das GWG-Konto zählt bei der Kategorie „Hardware“ (`euer-formel.ts`) |

Nicht verglichen werden:

- **Privatnutzung von Fahrzeugen in der Voranmeldung.** Sie zählt monatlich, gebucht wird sie erst mit der AfA im Dezember. Abgeglichen wird sie deshalb mit der EÜR, sobald das Jahr gebucht ist.
- **Bemessungsgrundlagen bei Ist-Versteuerung aus älteren Zahlungen.** Die Voranmeldung meldet Kz 81, 86, 43 und 48 mit der Zahlung; die Zahlungsbuchung trägt die Bemessungsgrundlage erst seit [#542](https://github.com/firsttris/haben/issues/542). Kz 81 und 86 vergleicht der Abgleich deshalb nur in Zeiträumen, in denen jede Umbuchung der Umsatzsteuer eine Bemessungsgrundlage trägt; Kz 43 und 48 bei Ist nicht, weil sich eine ältere Zahlung auf eine steuerfreie Rechnung nicht von einer Zahlung ohne Meldung unterscheiden lässt.
- **Belege mit § 13b oder innergemeinschaftlichem Erwerb, deren Steuer nicht voll abziehbar ist** (Privatanteil, ohne Vorsteuerabzug), bei den Bemessungsgrundlagen Kz 46, 84, 89 und 93: Ältere Buchungen trennen den privaten Teil bzw. die Steuer nicht mit Steuerschlüssel von der Bemessungsgrundlage. Die Steuerbeträge dieser Belege werden verglichen.
- **Ältere Korrekturen übernommener Lexoffice-Rechnungen** bei den Bemessungsgrundlagen: Sie buchen das Netto gegen den Saldenvortrag, bis [#542](https://github.com/firsttris/haben/issues/542) ohne Steuerschlüssel. Seitdem trägt die Zeile bei Soll-Versteuerung je Steuersatz den Steuerschlüssel und wird verglichen.
- **Eröffnungen.** Was eine Eröffnung (etwa aus dem DATEV-Stapel) auf Umsatz- und Vorsteuer vorträgt, ist in den Voranmeldungen der bisherigen Buchhaltung angemeldet und gehört nicht zum Januar.

**Wo der Abgleich erscheint:** in der [Vorprüfung](umsatzsteuer.md#vorprüfung) der Voranmeldung, unter **Einstellungen › Export › Änderungsprotokoll prüfen** und in der wöchentlichen Mail mit dem Prüfwert. Eine Abweichung ist kein Beweis für eine Manipulation, aber ein Widerspruch in den Büchern. Kläre ihn, bevor du die Voranmeldung sendest.

## Ist- und Soll-Versteuerung

Die Versteuerungsart wird unter Einstellungen festgelegt. Sie bestimmt, wann die Umsatzsteuer fällig wird:

- **Soll:** mit der Rechnung. Die Rechnungsbuchung geht direkt auf das Konto „Umsatzsteuer“, die Voranmeldung zählt nach Rechnungsdatum.
- **Ist:** mit dem Zahlungseingang. Die Rechnungsbuchung geht auf „Umsatzsteuer nicht fällig“. Beim Zahlungseingang wird der Steueranteil der Zahlung auf „Umsatzsteuer“ umgebucht, bei Teilzahlungen anteilig; die Voranmeldung zählt nach Buchungstag des Zahlungseingangs. Wie bei DATEV der Steuerschlüssel am Zahlungseingang ([DATEV-Dok. 1080673](https://help-center.apps.datev.de/documents/1080673)) trägt die Umbuchung auf „Umsatzsteuer“ die Bemessungsgrundlage des bezahlten Anteils (Spalte `basis` der Buchungszeile mit Vorzeichen, Bemessungsgrundlage im Journal-Export); den Anteil zu 0 % sowie Zahlungen auf steuerfreie Rechnungen und Ausfuhrlieferungen trägt die Forderungszeile mit Steuerschlüssel und Bemessungsgrundlage. Rundet der Steueranteil eines Satzes auf 0,00 € (kleine Raten, Restzahlungen von wenigen Cent), steht seine Bemessungsgrundlage an einer Umsatzsteuerzeile ohne Betrag; der DATEV-Export lässt solche Zeilen weg. Ältere Zahlungsbuchungen haben sie nicht. Reverse Charge, innergemeinschaftliche Lieferung und Drittland zählen mit der Rechnung, ihre Zahlung trägt nichts.

Die Vorsteuer zählt in beiden Fällen nach Belegdatum. Haben liest die Einstellung bei jeder Buchung neu. Ein Wechsel während offener Rechnungen würde Zahlungs- und Rechnungsbuchung auseinanderbringen (etwa bliebe Steuer auf „Umsatzsteuer nicht fällig“ stehen) und ihre Umsatzsteuer doppelt oder gar nicht anmelden. Haben sperrt deshalb den Wechsel, solange Rechnungen offen sind oder es im laufenden Jahr schon Buchungen gibt (`apps/web/src/server/modules/stammdaten/settings-guard.ts`, siehe [Erste Schritte](einrichtung.md#wann-sich-die-einstellungen-ändern-lassen)). Die Versteuerungsart sollte vor der ersten Rechnung feststehen und nur in Absprache mit der Steuerberatung geändert werden. Die EÜR ist unabhängig davon immer eine Zufluss-Abfluss-Rechnung (siehe [Auswertungen](auswertungen.md)).

Voranmeldungen und Umsatzsteuererklärung rechnen ein Jahr nach der Versteuerung, nach der es gebucht ist, nicht nach der aktuellen Einstellung. Maßgeblich ist, was beim Anlegen der ersten Buchung des Jahres eingestellt war; das steht im Änderungsprotokoll der Firmendaten (`versteuerungForYear` in `apps/web/src/server/modules/stammdaten/company.ts`). Ohne Buchung im Jahr gilt die aktuelle Einstellung. Stellst du zum Jahreswechsel um, rechnen die Monate des Vorjahres und die Umsatzsteuererklärung dafür, die du erst im neuen Jahr abgibst, also weiter nach dem alten Verfahren.

## Kontenrahmen

Haben bucht nach SKR03 oder SKR04. Die Zuordnung steht in `packages/core/src/posting.ts` (`ACCOUNTS`, `ACCOUNT_NAMES`, `EXPENSE_CATEGORIES`).

> [!IMPORTANT]
> Die Konten sind sorgfältig gewählt, aber nicht von einer Steuerberatung abgenommen. Sie sollten vor dem Echtbetrieb mit der Steuerberatung abgeglichen werden, besonders wenn diese mit den Daten weiterarbeitet.

### Bestands- und Steuerkonten

| Zweck | SKR03 | SKR04 |
| --- | --- | --- |
| Bank (alle Bankkonten auf einem Finanzkonto) | 1200 | 1800 |
| Kasse ([Kassenbuch](kasse.md)) | 1000 | 1600 |
| Forderungen aus Lieferungen und Leistungen | 1400 | 1200 |
| Verbindlichkeiten aus Lieferungen und Leistungen | 1600 | 3300 |
| Erlöse 19 % USt | 8400 | 4400 |
| Erlöse 7 % USt | 8300 | 4300 |
| Erlöse (ohne USt) | 8200 | 4200 |
| Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge) | 8336 | 4336 |
| Erlöse aus im Drittland steuerbaren Leistungen | 8338 | 4338 |
| Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG | 8125 | 4125 |
| Steuerfreie Umsätze § 4 Nr. 1a UStG (Ausfuhr) | 8120 | 4120 |
| Steuerfreie Umsätze § 4 Nr. 8 ff. UStG | 8100 | 4100 |
| Erlöse als Kleinunternehmer § 19 UStG | 8195 | 4185 |
| Umsatzsteuer 19 % | 1776 | 3806 |
| Umsatzsteuer 7 % | 1771 | 3801 |
| Umsatzsteuer nicht fällig 19 % | 1766 | 3816 |
| Umsatzsteuer nicht fällig 7 % | 1761 | 3811 |
| Vorsteuer 19 % | 1576 | 1406 |
| Vorsteuer 7 % | 1571 | 1401 |
| Umsatzsteuer nach § 13b UStG bzw. Vorsteuer daraus (Leistungsempfänger) | 1787 bzw. 1577 | 3837 bzw. 1407 |
| Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 % / 7 % | 1774 / 1772 | 3804 / 3802 |
| Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 % / 7 % | 1574 / 1572 | 1404 / 1402 |
| Umsatzsteuer-Vorauszahlungen | 1780 | 3820 |
| Sondervorauszahlung bei [Dauerfristverlängerung](umsatzsteuer.md#dauerfristverlängerung) (Umsatzsteuer-Vorauszahlung 1/11) | 1781 | 3830 |
| Umsatzsteuerverbindlichkeiten Vorjahr bzw. frühere Jahre ([Steuerzahlungen](bank.md#steuerzahlungen)) | 1790 bzw. 1791 | 3841 bzw. 3845 |
| Privatentnahmen | 1800 | 2100 |
| Privatsteuern (Einkommen-, Kirchensteuer, Soli des Inhabers vom Geschäftskonto) | 1810 | 2150 |
| Privateinlagen | 1890 | 2180 |
| Gesellschafter-Verrechnungskonto (nur GmbH, UG): Verbindlichkeiten gegenüber Gesellschaftern | 0730 | 3510 |
| Einbehaltene Kapitalertragsteuer, Soli und Kirchensteuer auf [Ausschüttungen](#gewinnausschüttung-gmbh-und-ug) (nur GmbH, UG) | 1746 | 3760 |
| Geldtransit | 1360 | 1460 |
| Verrechnungskonten der Zahlungsdienstleister (PayPal, Stripe, eBay …) | 1361–1369 | 1461–1469 |
| Nebenkosten des Geldverkehrs | 4970 | 6855 |
| Gewährte Skonti | 8730 | 4730 |
| Erhaltene Skonti | 3730 | 5730 |
| Forderungsverluste | 2400 | 6930 |
| Erträge bzw. Aufwendungen aus Kursdifferenzen (Fremdwährung) | 2660 bzw. 2150 | 4840 bzw. 6880 |
| Saldenvorträge Sachkonten | 9000 | 9000 |

Achtung bei der Nummer 1200: In SKR03 ist das die Bank, in SKR04 die Forderungen; in SKR03 ist 1800 die Privatentnahme, in SKR04 die Bank.

In einer GmbH oder UG (siehe [Rechtsform](einrichtung.md#rechtsform-einzelunternehmen-gmbh-oder-ug)) bucht Haben überall, wo im Einzelunternehmen Privateinlage oder Privatentnahme stünde, auf das Gesellschafter-Verrechnungskonto: beim vom Gesellschafter ausgelegten Beleg, bei Bankumsätzen „Gesellschafter (Verrechnungskonto)“ und bei Kassenbuchungen vom und an den Gesellschafter. Privatanteile, Kfz-Privatnutzung und Pauschalen gibt es dort nicht.

### Aufwandskonten der Belegkategorien

Jeder Beleg bekommt eine Kategorie. Sie bestimmt das Aufwandskonto und die Zeile in der EÜR.

| Kategorie | SKR03 | SKR04 |
| --- | --- | --- |
| Software und Lizenzen | 4964 | 6837 |
| Hosting und IT-Dienste | 4806 | 6495 |
| Hardware (GWG bis 800 € netto) | 0480 | 0670 |
| Telefon | 4920 | 6805 |
| Internet | 4925 | 6810 |
| Bürobedarf | 4930 | 6815 |
| Fachliteratur | 4940 | 6820 |
| Fortbildung | 4945 | 6821 |
| Reisekosten: Fahrten | 4673 | 6673 |
| Reisekosten: Übernachtung | 4676 | 6680 |
| Porto | 4910 | 6800 |
| Werbung | 4600 | 6600 |
| Bewirtung von Geschäftspartnern (70 % abziehbar) | 4650 | 6640 |
| Geschenke an Geschäftspartner (bis 50 € je Empfänger und Jahr) | 4630 | 6610 |
| Rechts- und Beratungskosten | 4950 | 6825 |
| Buchführung und Steuerberatung | 4955 | 6830 |
| Wareneinkauf (Handelsware) | 3200 | 5200 |
| Fremdleistungen | 3100 | 5900 |
| Kontoführung und Gebühren | 4970 | 6855 |
| Kfz: Laden, Tanken, Wartung | 4530 | 6530 |
| Kfz: Versicherung | 4520 | 6520 |
| Kfz: Steuer | 4510 | 7685 |
| Kfz: Reparaturen | 4540 | 6540 |
| Kfz: Leasing | 4570 | 6560 |
| Versicherungen | 4360 | 6400 |
| Beiträge | 4380 | 6420 |
| Sonstiger Aufwand | 4900 | 6300 |
| Miete für Geschäftsräume | 4210 Miete (unbewegliche Wirtschaftsgüter) | 6310 |
| Sonstiger Betriebsbedarf | 4980 | 6850 |
| Reparatur und Instandhaltung (Ausstattung, ohne EDV und Kfz) | 4805 Reparaturen und Instandhaltung von anderen Anlagen und Betriebs- und Geschäftsausstattung | 6470 |
| Kfz: sonstige Kosten | 4580 Sonstige Fahrzeugkosten | 6570 |
| Beiträge zur Berufsgenossenschaft (Personalaufwand) | 4138 | 6120 |
| Versorgungskassen (Altersversorgung der Arbeitnehmer, Personalaufwand) | 4160 | 6150 |
| Anlagegut (wird abgeschrieben), kein Aufwand: Anlagekonto der [Anlage](anlagen.md#art-und-abschreibung) | 0490 (je nach Art) | 0690 (je nach Art) |
| Einfuhrumsatzsteuer (Bescheid des Zolls), kein Aufwand: Vorsteuer Kz 62 | 1588 Entstandene Einfuhrumsatzsteuer | 1433 |

Die Konten der Kategorien Miete, Betriebsbedarf, Reparatur, sonstige Kfz-Kosten, Berufsgenossenschaft und Versorgungskassen sind dem DATEV-Kontenrahmen 2026 entnommen (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175). Berufsgenossenschaft und Versorgungskassen stehen in der GuV und der E-Bilanz bei den sozialen Abgaben bzw. der Altersversorgung (§ 275 Abs. 2 Nr. 6 Buchst. b HGB), Miete bei Miete und Pacht für unbewegliche Wirtschaftsgüter, Reparatur bei den Instandhaltungen, sonstige Kfz-Kosten bei den Fahrzeugkosten. Miete auf 4210 bzw. 6310 rechnet die Gewerbesteuer einer GmbH zur Hälfte hinzu (§ 8 Nr. 1 Buchst. e GewStG, siehe [Körperschaft- und Gewerbesteuer](#körperschaft--und-gewerbesteuer-gmbh-und-ug)).

Hardware wird als geringwertiges Wirtschaftsgut voll im Jahr der Zahlung abgezogen. Anlagevermögen mit Abschreibung bucht Haben über die Kategorie „Anlagegut“ und das [Anlagenverzeichnis](anlagen.md).

## Buchungssätze

Die Tabellen zeigen je Vorgang die Zeilen einer Buchung. Bei mehreren Steuersätzen entstehen Erlös-, Aufwands- und Steuerzeilen je Satz; Zeilen mit 0 € entfallen. Negative Beträge (Storno, Korrektur, Gutschrift, Rückzahlung) drehen Soll und Haben.

### Rechnung festschreiben

Beim Festschreiben einer Ausgangsrechnung, gebucht auf das Rechnungsdatum. Beschreibung: `Rechnung <Nummer> · <Kunde>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 8400 / 8300 / 8200 Erlöse | 4400 / 4300 / 4200 Erlöse | | netto je Satz |
| Soll: 1776 / 1771 Umsatzsteuer | Soll: 3806 / 3801 Umsatzsteuer | | Steuer je Satz |
| Ist: 1766 / 1761 USt nicht fällig | Ist: 3816 / 3811 USt nicht fällig | | Steuer je Satz |

Rechnungen ohne Steuerausweis (siehe [Rechnungen](rechnungen.md#umsatzsteuer-auf-der-rechnung)) haben keine Steuerzeile und gehen auf ein eigenes Erlöskonto, bei Ist- wie bei Soll-Versteuerung. Beispiel Reverse Charge über 1.000,00 €:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | 1.000,00 | |
| 8336 Erlöse Reverse Charge | 4336 Erlöse Reverse Charge | | 1.000,00 |

Leistungen ins Drittland gehen auf 8338 bzw. 4338, steuerfreie Umsätze nach § 4 UStG auf 8100 bzw. 4100, Kleinunternehmer-Rechnungen auf 8195 bzw. 4185.

### Stornorechnung und Rechnungskorrektur

Eine Stornorechnung ist eine neue Rechnung mit allen Positionen der ursprünglichen, negativ, und wird sofort festgeschrieben. Eine Rechnungskorrektur entsteht als Entwurf mit negativen Positionen, die angepasst werden; sie muss den Betrag mindern. Beide bekommen eine eigene Nummer, verweisen auf die ursprüngliche Rechnung, übernehmen deren Umsatzsteuer-Behandlung und werden wie oben gebucht, mit gedrehten Seiten:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 8400 / 8300 / 8200 Erlöse | 4400 / 4300 / 4200 Erlöse | netto je Satz | |
| 1776 / 1771 bzw. 1766 / 1761 | 3806 / 3801 bzw. 3816 / 3811 | Steuer je Satz | |
| 1400 Forderungen | 1200 Forderungen | | brutto |

Buchungsdatum ist das Datum der Storno- bzw. Korrekturrechnung.

War die ursprüngliche Rechnung schon bezahlt, bleibt die Stornorechnung mit dem gezahlten Betrag offen. Die Rückzahlung wird ihr im Bankabgleich zugeordnet und wie ein Zahlungseingang mit negativem Betrag gebucht (Forderungen an Bank, bei Ist-Versteuerung zusätzlich Umsatzsteuer an „Umsatzsteuer nicht fällig“). Bei aus Lexoffice übernommenen Rechnungen gehen Storno und Korrektur gegen den Saldenvortrag statt gegen die Erlöse, auch das Storno einer Korrektur dazu, siehe [Eröffnungsbuchungen](#eröffnungsbuchungen-für-offene-posten-aus-lexoffice). Bei Soll-Versteuerung meldet die Voranmeldung die Korrektur im Monat der Korrektur mit Bemessungsgrundlage und Steuer (§ 17 UStG); die Zeile gegen den Saldenvortrag trägt dafür je Steuersatz den Steuerschlüssel.

### Zahlungseingang auf eine Rechnung

Beim Zuordnen eines Bankumsatzes zu einer Rechnung im [Bankabgleich](bank.md), gebucht auf den Buchungstag des Umsatzes. Beschreibung: `Zahlung <Nummer> · <Gegenpartei>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1200 Bank | 1800 Bank | Zahlbetrag | |
| 1400 Forderungen | 1200 Forderungen | | Zahlbetrag |

Bei Ist-Versteuerung kommt die Umbuchung des Steueranteils dazu:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1766 / 1761 USt nicht fällig | 3816 / 3811 USt nicht fällig | Steueranteil je Satz | |
| 1776 / 1771 Umsatzsteuer | 3806 / 3801 Umsatzsteuer | | Steueranteil je Satz |

Der Steueranteil ist Zahlbetrag mal Steuer durch Bruttobetrag der Rechnung, je Satz gerundet; ein Rundungsrest geht auf den Satz mit der größten Bemessungsgrundlage. Bezahlt ein Kunde in Raten, wird jede Rate so gebucht.

### Beleg buchen

Beim Buchen eines Eingangsbelegs, gebucht auf das Belegdatum. Beschreibung: `Beleg <Rechnungsnummer> · <Lieferant>`. Die Beträge je Satz kommen vom Beleg, Haben rechnet die Steuer nicht nach.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| Aufwandskonto der Kategorie | Aufwandskonto der Kategorie | netto je Satz | |
| 1576 / 1571 Vorsteuer | 1406 / 1401 Vorsteuer | Steuer je Satz | |
| Zahlung „Bank“: 1600 Verbindlichkeiten | Zahlung „Bank“: 3300 Verbindlichkeiten | | brutto |
| Zahlung „privat“: 1890 Privateinlagen | Zahlung „privat“: 2180 Privateinlagen | | brutto |
| Zahlung „Kasse“: 1000 Kasse | Zahlung „Kasse“: 1600 Kasse | | brutto |

Ein privat oder bar aus der [Kasse](kasse.md) bezahlter Beleg ist damit erledigt. Ein über die Bank zu zahlender bleibt als Verbindlichkeit offen, bis die Zahlung im Bankabgleich zugeordnet ist. Gutschriften (negative Beträge) drehen die Seiten.

Bist du als Kleinunternehmer eingetragen, entfällt die Vorsteuerzeile: Der Bruttobetrag je Satz geht mit dem Steuerschlüssel `keineVSt` auf das Aufwandskonto. Ob mit oder ohne Vorsteuerabzug gebucht wurde, speichert Haben am Beleg (`documents.vorsteuer_abzug`), damit Voranmeldung und EÜR auch nach einem späteren Wechsel stimmen.

### Zahlung eines Belegs

Beim Zuordnen eines Bankumsatzes zu einem gebuchten Beleg, gebucht auf den Buchungstag. Beschreibung: `Zahlung Beleg <Nummer> · <Lieferant>`.

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | Zahlbetrag | |
| 1200 Bank | 1800 Bank | | Zahlbetrag |

### Bankumsätze ohne Rechnung oder Beleg

Im Bankabgleich lassen sich Umsätze ohne Rechnung oder Beleg einer dieser Arten zuordnen; die drei Lohnzahlungen nur über das, was eine festgeschriebene [Lohnabrechnung](#lohnabrechnung) als Verbindlichkeit gebucht hat und noch offen ist (ein Eingang nur, soweit überzahlt). Gebucht wird Bank gegen ein Gegenkonto, auf den Buchungstag. Bei einem Ausgang (negativer Betrag) steht die Bank im Haben, bei einem Eingang im Soll.

| Art | Gegenkonto SKR03 | Gegenkonto SKR04 | Ausgang | Eingang |
| --- | --- | --- | --- | --- |
| Privat | 1800 Privatentnahmen bzw. 1890 Privateinlagen | 2100 Privatentnahmen bzw. 2180 Privateinlagen | Entnahme an Bank | Bank an Einlage |
| Geldtransit (eigenes Konto) | 1360 | 1460 | Geldtransit an Bank | Bank an Geldtransit |
| Umsatzsteuer an das Finanzamt | 1780 | 3820 | Vorauszahlung an Bank | Bank an Vorauszahlung (Erstattung) |
| Sondervorauszahlung (Dauerfristverlängerung) | 1781 | 3830 | Sondervorauszahlung an Bank | Bank an Sondervorauszahlung (Erstattung) |
| Kapitalertragsteuer an das Finanzamt (Ausschüttung, nur GmbH und UG) | 1746 | 3760 | Verbindlichkeit an Bank | Bank an Verbindlichkeit |
| Kontoführung und Bankgebühren | 4970 | 6855 | Gebühren an Bank | Bank an Gebühren |
| Mahngebühren und Verzugszinsen | 2650 Sonstige Zinsen und ähnliche Erträge | 7100 | – | Bank an Zinserträge, ohne Umsatzsteuer |
| Zinserträge (Guthabenzinsen auf ein betriebliches Konto) | 2650 Sonstige Zinsen und ähnliche Erträge | 7100 | – | Bank an Zinserträge, ohne Umsatzsteuer |
| Steuerzahlung oder Erstattung | nach Steuerart, Bezugsjahr und Teil, siehe [Steuerzahlungen](bank.md#steuerzahlungen) | ebenso | Steuerkonto an Bank | Bank an Steuerkonto |
| Einnahme oder Ausgabe (Kategorie, Steuersatz) | Erlöse 8400/8300 mit Umsatzsteuer 1776/1771, Kleinunternehmer 8195, Ausgaben auf das Konto der Kategorie, siehe [Auf eine Kategorie buchen](bank.md#auf-eine-kategorie-buchen) | 4400/4300 mit 3806/3801, 4185, Konto der Kategorie | Aufwand an Bank (ohne Vorsteuer), Erlösminderung | Bank an Erlöse und Umsatzsteuer |
| Darlehen: Auszahlung, Tilgung, Zinsen, Gebühren | Darlehenskonto (0630–0650, 1705–1708), Zinsen 2110/2120/2126, Gebühren 2141, siehe [Darlehen](bank.md#darlehen) | 3150–3170, 3560–3567, 7310/7320/7326, 7355 | Tilgung, Zinsen, Gebühren an Bank | Bank an Darlehen (Auszahlung) |
| Lohn/Gehalt an Mitarbeiter | 1740 Verbindlichkeiten aus Lohn und Gehalt | 3720 | Verbindlichkeit an Bank | Bank an Verbindlichkeit (Rückzahlung) |
| Lohnsteuer an das Finanzamt | 1741 Verbindlichkeiten aus Lohn- und Kirchensteuer | 3730 | Verbindlichkeit an Bank | Bank an Verbindlichkeit (Erstattung) |
| SV-Beiträge an Krankenkasse oder Minijob-Zentrale | 1742 Verbindlichkeiten im Rahmen der sozialen Sicherheit | 3740 | Verbindlichkeit an Bank | Bank an Verbindlichkeit (Erstattung) |

Eine Steuerzahlung trägt Steuerart (`allocations.tax_type`), Bezugsjahr (`tax_year`) und Teil (`tax_item`: Steuer, Zinsen nach § 233a AO, §§ 234, 237 AO oder § 235 AO, Säumnis- oder Verspätungszuschlag); die drei Angaben sind mit der Zuordnung gesperrt und versiegelt, eine Aufhebung übernimmt sie in die Gegenzeile. Kontierung und EÜR folgen daraus (`packages/core/src/steuerzahlung.ts`), Buchungszeilen ohne Steuerschlüssel: Eine Steuerzahlung erzeugt weder Umsatz noch Vorsteuer. In der EÜR (Einzelunternehmen, nach Zahlung) zählt die Umsatzsteuer früherer Jahre als gezahlte bzw. erstattete Umsatzsteuer, Zinsen und Zuschläge zur Umsatzsteuer als übrige Betriebsausgaben, Erstattungszinsen zur Umsatz- und Gewerbesteuer als Einnahme (BFH, Urteil vom 26.09.2025, IV R 16/23); Gewerbesteuer samt Nachzahlungszinsen und Zuschlägen mindert den Gewinn nicht (§ 4 Abs. 5b EStG) und steht wie Hinterziehungszinsen (§ 4 Abs. 5 Satz 1 Nr. 8a EStG) nur nachrichtlich da; private Steuern sind Entnahmen. Der [Abgleich](#abgleich-von-journal-umsatzsteuer-und-eür) vergleicht die Steuerkonten im Journal mit diesen Posten.

Beispiel Bankgebühr von 9,90 € in SKR03:

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 4970 Nebenkosten des Geldverkehrs | 6855 Nebenkosten des Geldverkehrs | 9,90 | |
| 1200 Bank | 1800 Bank | | 9,90 |

### Zuordnung aufheben

Eine Zuordnung wird nicht gelöscht. Haben legt eine Gegenzeile mit negativem Betrag an (`allocations.reverses_id`) und bucht eine Gegenbuchung mit allen Zeilen der ursprünglichen Buchung, Soll und Haben vertauscht. Sie verweist über `reverses_id` auf die ursprüngliche Buchung, trägt die Beschreibung `Storno: …` und das Datum des Bankumsatzes. Danach ist der Umsatz wieder offen und kann neu zugeordnet werden.

### Eröffnungsbuchungen für offene Posten aus Lexoffice

Beim [Umzug aus Lexoffice](lexoffice.md) lassen sich unbezahlte Rechnungen und Eingangsbelege übernehmen. Erlös bzw. Aufwand stehen schon in den alten Büchern, deshalb bucht Haben gegen den Saldenvortrag, auf den Tag nach dem [Stichtag](lexoffice.md#stichtag), den ersten Tag in Haben (meist den 1. Januar). Übernommen wird, was am Stichtag offen war, auch wenn es danach bezahlt wurde.

Offene Rechnung bei Ist-Versteuerung (die Steuer ist noch nicht angemeldet und wird mit dem Zahlungseingang fällig):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 1766 / 1761 USt nicht fällig | 3816 / 3811 USt nicht fällig | | Steuer je Satz |
| 9000 Saldenvorträge | 9000 Saldenvorträge | | netto |

Offene Rechnung bei Soll-Versteuerung (die Steuer ist schon angemeldet):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 1400 Forderungen | 1200 Forderungen | brutto | |
| 9000 Saldenvorträge | 9000 Saldenvorträge | | brutto |

Offener Eingangsbeleg (die Vorsteuer ist schon angemeldet):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 9000 Saldenvorträge | 9000 Saldenvorträge | brutto | |
| 1600 Verbindlichkeiten | 3300 Verbindlichkeiten | | brutto |

Die spätere Zahlung wird wie jede andere gebucht. Für die Voranmeldung zählt bei Soll-Versteuerung eine übernommene Rechnung nicht noch einmal, ebenso wenig die Vorsteuer eines übernommenen Belegs. Steht schon eine [Eröffnung aus dem DATEV-Stapel](lexoffice.md#eröffnung-aus-dem-datev-stapel-gmbh-und-ug) nach dem Belegdatum, entfällt die Buchung: Der Posten steckt im Saldo der Forderungen bzw. Verbindlichkeiten der Eröffnung. Umgekehrt rechnet der Vorschlag der Eröffnung vorher übernommene Posten heraus.

### Anlagen und AfA

Ein Beleg mit der Kategorie „Anlagegut“ bucht den Nettobetrag auf das Anlagekonto statt in den Aufwand (ohne Vorsteuerabzug den Bruttobetrag). Zum Jahresende bucht **AfA … buchen** je Anlage AfA-Konto an Anlagekonto, beim Abgang zusätzlich den Restbuchwert (2310 bzw. 6895) an Anlagekonto. Übernommene Anlagen bekommen mit der ersten AfA ihre Eröffnung Anlagekonto an 9000. Konten und Beispiele stehen unter [Anlagen und AfA](anlagen.md).

### Pauschalen ohne Beleg

Homeoffice-Tage, Fahrten mit dem Privatfahrzeug und Verpflegungsmehraufwand bucht Haben beim Eintragen als Aufwand an Privateinlage (1890 bzw. 2180):

| Pauschale | SKR03 | SKR04 |
| --- | --- | --- |
| Homeoffice-Tagespauschale | 4288 | 6348 |
| Fahrten mit dem Privatfahrzeug | 4673 | 6673 |
| Verpflegungsmehraufwand | 4674 | 6674 |

Ein Storno ist eine Gegenbuchung am selben Tag. Sätze und Grenzen stehen unter [Pauschalen](pauschalen.md).

### Lohnabrechnung

Beim Festschreiben einer [Lohnabrechnung](lohn.md#buchung), gebucht auf den letzten Tag des abgerechneten Monats, ohne Steuerschlüssel. Beschreibung: `Lohn <Monat> · <Name>`. Die Konten stehen so im DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175; `LOHN_KONTEN` in `packages/core/src/lohn-buchung.ts`):

| Konto SKR03 | Konto SKR04 | Soll | Haben |
| --- | --- | --- | --- |
| 4120 Gehälter, 4124 Geschäftsführergehälter der GmbH-Gesellschafter bzw. 4195 Löhne für Minijobs | 6020, 6024 bzw. 6035 | Brutto | |
| 4130 Gesetzliche soziale Aufwendungen bzw. im Minijob 4144 Soziale Abgaben für Minijobber | 6110 bzw. 6171 | Anteile des Arbeitgebers, Umlagen U1, U2, Insolvenzgeld | |
| 4194 Pauschale Steuer für Minijobber | 6036 | Pauschsteuer 2 % | |
| 1740 Verbindlichkeiten aus Lohn und Gehalt | 3720 | | Auszahlung |
| 1741 Verbindlichkeiten aus Lohn- und Kirchensteuer | 3730 | | Lohnsteuer, Soli, Kirchensteuer |
| 1742 Verbindlichkeiten im Rahmen der sozialen Sicherheit | 3740 | | Anteile beider Seiten, Umlagen, im Minijob die Pauschsteuer |

Beispiel Beschäftigter mit 4.000,00 € im Oktober 2026 (Steuerklasse I ohne Kinderfreibetrag, vier Kinder unter 25 in der Pflegeversicherung, Zusatzbeitrag 3,1 %, Umlagen 1,6 % und 0,44 %), SKR04:

| Konto | Soll | Haben |
| --- | --- | --- |
| 6020 Gehälter | 4.000,00 | |
| 6110 Gesetzliche soziale Aufwendungen | 937,60 | |
| 3720 Verbindlichkeiten aus Lohn und Gehalt | | 2.640,17 |
| 3730 Verbindlichkeiten aus Lohn- und Kirchensteuer | | 539,83 |
| 3740 Verbindlichkeiten im Rahmen der sozialen Sicherheit | | 1.757,60 |

Achtung bei 3730: Im SKR04 ist das die Lohnsteuer, im SKR03 „Erhaltene Skonti“. Ein Storno der Abrechnung ist eine Gegenbuchung am selben Tag. Bezahlt werden die Verbindlichkeiten im Bankabgleich ([Bankumsätze ohne Rechnung oder Beleg](#bankumsätze-ohne-rechnung-oder-beleg)).

Für Minijobs nennt der DATEV-Kontenrahmen 2026 eigene Konten (4195, 4194, 4144 bzw. 6035, 6036, 6171), nicht die allgemeinen Aushilfslöhne (4190 bzw. 6030); die E-Bilanz fragt Löhne für Minijobs getrennt ab. Beiträge zur Berufsgenossenschaft (4138 bzw. 6120) bucht die Lohnabrechnung nicht; sie kommen jährlich mit dem Bescheid.

In der EÜR eines Einzelunternehmens zählt nicht diese Buchung, sondern die Zahlung: Lohn, Lohnsteuer und Beiträge sind am Tag der Zuordnung im Bankabgleich „Ausgaben für eigenes Personal“ (Anlage EÜR, Kennzahl E6001801).

## Steuerschlüssel und Kennzahlen

Erlös-, Aufwands- und Steuerzeilen tragen einen Steuerschlüssel. Forderungen, Verbindlichkeiten, Bank, Privat- und Saldenvortragskonten bleiben ohne; ebenso die Zeilen der Eröffnungsbuchungen.

| Schlüssel | Satz | Kennzahl der Voranmeldung | Bedeutung |
| --- | --- | --- | --- |
| `USt19` | 19 % | 81 | Umsatzsteuer 19 % |
| `USt7` | 7 % | 86 | Umsatzsteuer 7 % |
| `frei` | 0 % | – | Ohne Umsatzsteuer (regulär besteuert) |
| `RC` | 0 % | 21 | Reverse Charge, Leistung im EU-Ausland |
| `Drittland` | 0 % | 45 | Nicht steuerbar, Leistungsort im Drittland |
| `Steuerfrei` | 0 % | 48 | Steuerfrei ohne Vorsteuerabzug |
| `KU` | 0 % | – | Kleinunternehmer § 19 UStG |
| `VSt19` | 19 % | 66 | Vorsteuer 19 % |
| `VSt7` | 7 % | 66 | Vorsteuer 7 % |
| `keineVSt` | 0 % | – | Ohne Vorsteuer, auch für Belege von Kleinunternehmern |
| `IGL` | 0 % | 41 | Steuerfreie innergemeinschaftliche Lieferung |
| `Ausfuhr` | 0 % | 43 | Steuerfreie Ausfuhrlieferung |
| `RC13bEU` | 19 % / 7 % | 46 / 47 | Steuerschuld als Leistungsempfänger, Leistung eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1 UStG) |
| `RC13bDrittland` | 19 % / 7 % | 84 / 85 | Steuerschuld als Leistungsempfänger, Leistung eines Unternehmers aus dem Drittland (§ 13b Abs. 2 Nr. 1 UStG) |
| `VSt13b` | 19 % / 7 % | 67 | Vorsteuer aus § 13b |
| `IGE19` / `IGE7` | 19 % / 7 % | 89 / 93 | Innergemeinschaftlicher Erwerb |
| `VStIGE` | 19 % / 7 % | 61 | Vorsteuer aus innergemeinschaftlichem Erwerb |
| `EUSt` | – | 62 | Entstandene Einfuhrumsatzsteuer (Bescheid des Zolls) |

Die Kennzahlen der [Voranmeldung](umsatzsteuer.md) rechnet Haben aus denselben Quellen wie die Buchungen (`apps/web/src/server/modules/umsatzsteuer/vat-figures.ts`):

- **Kz 81 und 86:** Bemessungsgrundlagen der regulär besteuerten Rechnungen zu 19 % bzw. 7 %, bei Soll aus den festgeschriebenen Rechnungen des Monats, bei Ist aus den zugeordneten Zahlungseingängen des Monats, anteilig je Zahlung; dazu bei Ist und Soll die direkt auf eine Einnahmekategorie gebuchten Bankumsätze des Monats. ELSTER bekommt sie in vollen Euro, die Steuer wird daraus neu berechnet.
- **Kz 21, 41, 43, 45 und 48:** Bemessungsgrundlagen der Rechnungen mit Reverse Charge, innergemeinschaftlicher Lieferung, Ausfuhrlieferung, ins Drittland bzw. steuerfrei nach § 4 UStG, in vollen Euro und ohne Steuer. Kz 43 und 48 zählen wie Kz 81, Kz 21, 41 und 45 immer nach Rechnungsdatum.
- **Kz 89, 93 und 61:** Bemessungsgrundlagen der Belege mit innergemeinschaftlichem Erwerb zu 19 % bzw. 7 % und die Vorsteuer daraus, nach Belegdatum, auch bei Ist-Versteuerung.
- **Kz 46, 47, 84, 85 und 67:** Bemessungsgrundlagen und Steuer der Belege, bei denen du die Steuer als Leistungsempfänger schuldest (§ 13b UStG, aus dem EU-Ausland bzw. Drittland), und die abziehbare Vorsteuer daraus, nach Belegdatum.
- **Kz 62:** entstandene Einfuhrumsatzsteuer aus Belegen der Kategorie „Einfuhrumsatzsteuer“, nach Belegdatum.
- **Kz 66:** Vorsteuer aus den gebuchten Belegen des Monats nach Belegdatum, ohne Belege, die ohne Vorsteuerabzug gebucht sind.
- **Kz 83:** Umsatzsteuer aus Kz 81, 86, 89 und 93 plus Kz 47 und 85, minus Kz 66, 67, 61 und 62 und minus einer angerechneten Sondervorauszahlung (Kz 39).

Regulär besteuerte Umsätze zu 0 % (Schlüssel `frei`) meldet Haben nicht; die Vorprüfung weist darauf hin, damit sie an der Rechnung als Reverse Charge, Drittland oder steuerfrei eingestellt werden können, falls das zutrifft.

## Die Seite „Buchungen“

Unter **Buchungen** steht das Journal je Monat, neueste zuerst, mit Pfeilen zum Vor- und Folgemonat. Jede Buchung ist eine Zeile:
- Datum und Herkunft („Rechnung“, „Beleg“, „Bank“, „Anlage“, „Pauschale“, „Kasse“, „Ausbuchung“, „Lohn“, in GmbH und UG „Manuell“, „Eröffnung“ und „Ausschüttung“, oder „Gegenbuchung“). Ein Klick auf die Herkunft öffnet den Vorgang.
- Buchungstext.
- Soll- und Habenkonto, jeweils das größte. Weitere Konten stehen als „+n“ daneben.
- Betrag und Steuerschlüssel.

Der Pfeil links klappt alle Buchungszeilen mit Soll, Haben und Steuerschlüssel auf.

Darüber lässt sich nach Herkunft, Kontonummer und Text filtern. Unten stehen die Zahl der Buchungen und ihre Summe.

Gebucht wird über Rechnungen, Belege, Bank, Kasse, Anlagen, Pauschalen, Ausbuchungen und Lohnabrechnungen; in einer GmbH oder UG zusätzlich mit [manuellen Buchungen](#manuelle-und-freie-buchungen), der [Eröffnung](#saldenvortrag-und-eröffnung-gmbh-und-ug) und [Ausschüttungen](#gewinnausschüttung-gmbh-und-ug). Ein Klick auf eine Kontonummer öffnet das Kontenblatt des Monats.

## Manuelle und freie Buchungen

Auf der Seite **Buchungen** steht der Knopf **Buchung erfassen**. Damit buchst du Soll an Haben auf frei gewählten Konten. In GmbH und UG geht das immer, im Einzelunternehmen ab dem Stichjahr, wenn Voranmeldung und EÜR aus dem Journal rechnen ([Abgleich](#abgleich-von-journal-umsatzsteuer-und-eür)). Davor rechnet die Anlage EÜR aus Rechnungen, Belegen und Zahlungen, eine Buchung nur im Journal käme dort nicht an. Beispiele in GmbH und UG:

| Vorgang | SKR03 | SKR04 |
| --- | --- | --- |
| Stammkapital, vom Gesellschafter noch nicht über die Bank eingezahlt | 0730 an 0800 Gezeichnetes Kapital | 3510 an 2900 |
| Auslagen des Gesellschafters in ein längerfristiges Darlehen umwandeln | 0730 an 0740 Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit 1 bis 5 Jahre | 3510 an 3514 |
| Falsche Kontierung umbuchen | neues an altes Aufwandskonto | ebenso |

Eine Zeile hat ein Konto mit vier Ziffern und einen Betrag im Soll oder im Haben, bis zu 20 Zeilen je Buchung; Soll und Haben müssen gleich sein. Die Kontobezeichnung erscheint, wenn Haben das Konto kennt.

Im Einzelunternehmen steht neben einem Erfolgskonto nur ein Privatkonto, etwa eine Ausgabe ohne Beleg, privat bezahlt (Aufwand an Privateinlagen). Jedes Erfolgskonto braucht eine Zeile der Anlage EÜR; Zahlungen gehen über Bank oder Kasse.

**Mit Steuerschlüssel (freie Buchung).** Ab dem Stichjahr kann eine Zeile einen Steuerschlüssel tragen, wie bei DATEV ([Entwurf, Entscheidung 4](adr/journal-als-quelle.md)):

| Steuerschlüssel | Erlöskonto SKR03 | SKR04 | Voranmeldung |
| --- | --- | --- | --- |
| USt 19 % | 8400 | 4400 | Kz 81 |
| USt 7 % | 8300 | 4300 | Kz 86 |
| 0 % | 8200 | 4200 | keine Kennzahl |

- Der Betrag der Zeile ist **brutto**. Haben teilt ihn in Netto auf das Erlöskonto und Umsatzsteuer auf das Umsatzsteuerkonto des Satzes, kaufmännisch gerundet; das Formular zeigt vor dem Buchen, was gebucht wird. Beide Zeilen tragen den Schlüssel.
- **Gegenkonto** ist ein Erfolgskonto oder, für eine Leistung für private Zwecke (§ 3 Abs. 9a UStG), im Einzelunternehmen ein Privatkonto, in GmbH und UG das Gesellschafter-Verrechnungskonto (SKR03 0730, SKR04 3510). Forderungen gehören zu einer Rechnung: Ein Verkauf auf Ziel ohne Rechnung, dessen Steuer bei Ist erst mit der Zahlung entstünde, geht so nicht.
- **Keine Vorsteuer:** Eine freie Buchung ist ein Eigenbeleg, der Vorsteuerabzug braucht eine Rechnung (§ 15 Abs. 1 Nr. 1 Satz 2 UStG). Dafür gibt es [Belege](belege.md), auch privat bezahlt.
- **Als Kleinunternehmer** gibt es keinen Steuerschlüssel (§ 19 Abs. 1 UStG).
- **Datum:** nicht in einem gemeldeten Zeitraum, also nicht nach einer gesendeten Voranmeldung des Monats oder Quartals, einer gesendeten Jahreserklärung oder einem abgeschlossenen Jahr; das gilt auch für jede manuelle Buchung im Einzelunternehmen.
- Voranmeldung und EÜR zählen die Buchung aus dem Journal; im [Abgleich](#abgleich-von-journal-umsatzsteuer-und-eür) zählt die Gegenprobe sie aus der festgeschriebenen Buchung selbst, denn ein Nebenbuch hat sie nicht.
- **Sachentnahme:** Entnehmt ihr Waren oder Gegenstände des Betriebs für private Zwecke (unentgeltliche Wertabgabe, § 3 Abs. 1b UStG), bucht ihr Privat an das Konto der Sachentnahme mit Steuerschlüssel: SKR03 8910 (19 %) bzw. 8915 (7 %), SKR04 4620 bzw. 4610 (eine Zeit lang buchte Haben die 7 % in SKR04 auf 4630; was dort steht, zählt weiter als Sachentnahme, neu bebuchen lässt sich 4630 nicht). Als Betrag den Wert der Entnahme brutto: den Einkaufspreis zum Zeitpunkt der Entnahme bzw. die Selbstkosten zuzüglich Umsatzsteuer (§ 10 Abs. 4 Nr. 1 UStG). In der Voranmeldung zählt das Netto in Kz 81 bzw. 86, in der Anlage EÜR in der Zeile „Sonstige Sach-, Nutzungs- und Leistungsentnahmen“ (§ 6 Abs. 1 Nr. 4 Satz 1 EStG), die Umsatzsteuer darauf bei der vereinnahmten Umsatzsteuer. Ohne Steuerschlüssel lassen sich diese Konten nicht bebuchen; als Kleinunternehmer gibt es die Buchung deshalb nicht.

Nicht bebuchbar sind die Konten, die ein Nebenbuch führt, weil eine Buchung daran vorbei den Abgleich zwischen Nebenbuch und Journal bräche:

| Konten | Nebenbuch |
| --- | --- |
| Bank, Zahlungsdienstleister, Geldtransit | Bankabgleich |
| Kasse | Kassenbuch |
| Forderungen, Verbindlichkeiten aus Lieferungen und Leistungen | Rechnungen und Belege (offene Posten) |
| Umsatzsteuer, Vorsteuer (auch § 13b und innergemeinschaftlicher Erwerb), entstandene Einfuhrumsatzsteuer (SKR03 1588, SKR04 1433), Umsatzsteuer-Vorauszahlungen und Sondervorauszahlung | Voranmeldung |
| Erlöskonten der Rechnungen | Rechnungen |
| Anlagen, AfA, Restbuchwert | Anlagenverzeichnis |
| Lohnaufwand und Lohnverbindlichkeiten (SKR03 4120, 4124, 4130, 4144, 4194, 4195, 1740–1742; SKR04 6020, 6024, 6035, 6036, 6110, 6171, 3720–3740) | Lohnabrechnung; die Verbindlichkeiten sind in der Eröffnung erlaubt |
| Klasse 9 (Saldenvorträge, statistische Konten) | – |
| Privatkonten (SKR03 1800–1899, SKR04 2100–2199) | gibt es in GmbH und UG nicht |

Das Formular zeigt beim Tippen, was fehlt; der Server prüft beim Buchen dasselbe noch einmal. Das Datum darf nicht in der Zukunft liegen. Die Buchung ist sofort festgeschrieben und versiegelt wie jede andere (Herkunft „Manuell“); sie steht im Journal, in der Saldenliste, im Jahresexport und im DATEV-Export. Korrigiert wird mit **Stornieren** in den aufgeklappten Buchungszeilen: Die Gegenbuchung steht am selben Tag, damit sich beide im selben Zeitraum aufheben. Steuerschlüssel und Bemessungsgrundlagen dreht sie mit. Ist der Zeitraum einer freien Buchung schon gemeldet oder der Kontenrahmen inzwischen ein anderer, steht der Storno am Tag des Stornos, mit den Konten derselben Rolle im neuen Kontenrahmen.

## Saldenvortrag und Eröffnung (GmbH und UG)

Eine GmbH oder UG bilanziert: Ihre Bestandskonten laufen über den Jahreswechsel weiter. Haben trägt deshalb in der Saldenliste, im Kontenblatt und in den Kacheln der Seite **Konten** zum 1. Januar vor:

- **Bestandskonten** (Anlagen, Bank, Kasse, Forderungen, Verbindlichkeiten, Steuern, Eigenkapital, Gesellschafter) mit ihrem Saldo aus allen Vorjahren.
- **Erfolgskonten** (Erlöse und Aufwand) beginnen bei null. Ihr Ergebnis aus den Vorjahren steht als Gewinnvortrag (Saldo im Haben) bzw. Verlustvortrag vor Verwendung (im Soll) im Eigenkapital, bis eine Buchung es verwendet, etwa für eine Ausschüttung.

| Konto | SKR03 | SKR04 |
| --- | --- | --- |
| Gewinnvortrag vor Verwendung | 0860 | 2970 |
| Verlustvortrag vor Verwendung | 0868 | 2978 |

Die Summe aller Vorträge ist null wie im Journal. Bestandskonten sind nach DATEV im SKR04 die Klassen 0 bis 3, im SKR03 die Klassen 0, 1 und 7 sowie 3970 bis 3989 (Bestände; 3990 „Verrechnete Stoffkosten“ ist wieder Aufwand); die Klasse 9 trägt ebenfalls vor. Diese Einteilung ist gegen den DATEV-Kontenrahmen 2026 geprüft: Ein Konto hat dort genau dann einen Bilanzposten, wenn es ein Bestandskonto ist, ausgenommen die Konten der Ergebnisverwendung (SKR03 2795 bis 2868, SKR04 7700 bis 7751).

Alle vier Konten stehen so im DATEV-Kontenrahmen 2026.

Der Vortrag ist berechnet, nicht gebucht: Bucht jemand nachträglich ins Vorjahr (eine Rechnung vom 31.12., eine Abschlussbuchung), stimmt der Vortrag sofort wieder. Vorgetragen wird im Kontenrahmen der Firmendaten; bei GmbH und UG ist er deshalb ab der ersten Buchung fest (`0101_kontenrahmen_kapg.sql`). Im Einzelunternehmen mit EÜR beginnt jedes Jahr bei null wie bisher. Den DATEV-Export betrifft der Vortrag nicht; den Saldenvortrag in DATEV übernimmt die Steuerberatung aus dem Vorjahr.

**Eröffnungsbuchung:** Beginnt die Buchhaltung der GmbH nicht in Haben, übernimmst du die Bestände der bisherigen Buchhaltung mit **Buchung erfassen › Eröffnungsbuchung**. Sie steht am 1. Januar des ersten Jahres in Haben und bucht nur Bestandskonten, dazu den Kontostand der Bank und 9000 Saldenvorträge, zum Beispiel:

| | SKR03 | SKR04 |
| --- | --- | --- |
| Bank an Saldenvorträge | 1200 an 9000 | 1800 an 9000 |
| Saldenvorträge an Gezeichnetes Kapital, Gewinnvortrag, Gesellschafter | 9000 an 0800, 0860, 0730 | 9000 an 2900, 2970, 3510 |

Offene Rechnungen und Belege übernimmst du einzeln über den [Umzug](lexoffice.md) (Forderung bzw. Verbindlichkeit an 9000), Anlagen über das [Anlagenverzeichnis](anlagen.md), die Kasse über das Kassenbuch. Sind alle Bestände übernommen, ist 9000 ausgeglichen.

**Eröffnung aus dem DATEV-Stapel:** Liegt der Buchungsstapel der bisherigen Buchhaltung im Archiv, schlägt Haben auf derselben Seite die ganze Eröffnung aus der Schlussbilanz des letzten Stapeljahres vor, mit allen Bestandskonten einschließlich Bank, Kasse, Forderungen, Verbindlichkeiten, Umsatzsteuer und Anlagen; gebucht wird sie erst nach deiner Bestätigung. Die Lockerung gilt nur für diesen Vorschlag, den Haben beim Buchen selbst neu rechnet; die Eröffnung von Hand bleibt auf Bestandskonten ohne Nebenbuch, Bank und 9000 beschränkt. Wie offene Posten, Umsatzsteuer und Kasse dabei behandelt werden, steht unter [Eröffnung aus dem DATEV-Stapel](lexoffice.md#eröffnung-aus-dem-datev-stapel-gmbh-und-ug). Ist sie gebucht, lehnt Haben eine weitere Eröffnung von Hand ab. In der Saldenliste stehen Eröffnungsbuchungen in der Spalte Eröffnung, im Journal mit der Herkunft „Eröffnung“.

Gibt es vor dem 1. Januar schon Buchungen in Haben, lehnt Haben eine Eröffnung ab; die Salden trägt es dann selbst vor. Umgekehrt lässt sich nach einer Eröffnung nichts mehr davor buchen, auch kein rückdatierter Beleg, sonst zählten die übernommenen Salden doppelt.

## Jahresabschluss (GmbH und UG)

Unter **Buchhaltung › Jahresabschluss** zeigt Haben für eine GmbH oder UG Bilanz und Gewinn- und Verlustrechnung eines Jahres in der Form einer Kleinstkapitalgesellschaft (§ 267a HGB):

- **Bilanz** nur mit den Posten, die in § 266 Abs. 2 und 3 HGB Buchstaben tragen (§ 266 Abs. 1 Satz 4): Anlagevermögen, Umlaufvermögen, Rechnungsabgrenzung; Eigenkapital, Rückstellungen, Verbindlichkeiten, Rechnungsabgrenzung. Jeder Posten klappt die Konten auf, die in ihm stehen.
- **GuV** nach § 275 Abs. 5 HGB: Umsatzerlöse, sonstige Erträge, Materialaufwand, Personalaufwand, Abschreibungen, sonstige Aufwendungen, Steuern und als Ergebnis Jahresüberschuss oder Jahresfehlbetrag. Zinserträge zählen zu den sonstigen Erträgen, Zinsaufwand zu den sonstigen Aufwendungen.

Die Salden sind die der [Saldenliste](#die-seite-konten) zum 31.12., mit Vortrag. Das Jahresergebnis steht im Eigenkapital. Ein Konto des Umlaufvermögens mit Haben-Saldo (überzogene Bank, Umsatzsteuer-Zahllast) steht unter den Verbindlichkeiten, eine Verbindlichkeit mit Soll-Saldo (der Gesellschafter schuldet der GmbH) im Umlaufvermögen.

**Zuordnung der Konten:** Jedes Konto gehört nach seinem Kontenbereich zu einem Posten (`packages/core/src/hgb.ts`). Die Bereiche sind aus dem DATEV-Kontenrahmen 2026 erzeugt (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175): je Konto der Bilanz- bzw. GuV-Posten, den DATEV in der linken Spalte nennt, verdichtet auf die Ebene der Kleinstkapitalgesellschaft. Nennt DATEV zwei Posten („Sonstige Verbindlichkeiten oder Sonstige Vermögensgegenstände“), gilt der zweite bei umgekehrtem Saldo: Die überzogene Bank steht unter den Verbindlichkeiten, „Umsatzsteuer nicht fällig“ mit Haben-Saldo unter den Steuerrückstellungen, mit Soll-Saldo unter den sonstigen Vermögensgegenständen, das Gesellschafter-Verrechnungskonto je nach Saldo unter den Verbindlichkeiten oder Forderungen. Anlagevermögen gibt es nur in Klasse 0; gleichnamige Posten in Klasse 1 sind Umlaufvermögen. Erhaltene Anzahlungen, die DATEV offen von den Vorräten absetzt (SKR03 1722, SKR04 1190), stehen mit negativem Betrag im Umlaufvermögen; abgeführte Gewinne (Gewinngemeinschaft, Gewinnabführungsvertrag, stille Beteiligung) sind sonstige Aufwendungen. Jedes Konto, das Haben selbst bebucht, hat einen Posten. Keinen Posten haben Sonderposten und die Konten der Ergebnisverwendung (Einstellungen in Rücklagen, Ertrag aus Kapitalherabsetzung, Ausschüttung), die nach dem Jahresergebnis stehen; solche Konten und nicht ausgeglichene Vortragskonten (9000) nennt die Seite unter **Offene Punkte**, statt sie still wegzulassen.

### Vermerke unter der Bilanz

Unter den Posten stehen Vermerke, die das Gesetz auch der Kleinstkapitalgesellschaft nicht erlässt; ohne Anhang gehören sie in die Bilanz (`packages/core/src/bilanzvermerke.ts`):

- **Restlaufzeiten** ([§ 268 HGB](https://www.gesetze-im-internet.de/hgb/__268.html)): beim Umlaufvermögen die Forderungen mit einer Restlaufzeit von mehr als einem Jahr (Abs. 4 Satz 1), bei den Verbindlichkeiten die Beträge mit einer Restlaufzeit bis zu einem Jahr und von mehr als einem Jahr (Abs. 5 Satz 1). [§ 274a HGB](https://www.gesetze-im-internet.de/hgb/__274a.html) befreit kleine und Kleinstkapitalgesellschaften nur von Satz 2 bzw. Satz 3, den Erläuterungen im Anhang.
- **Gegenüber Gesellschaftern** ([§ 42 Abs. 3 GmbHG](https://www.gesetze-im-internet.de/gmbhg/__42.html)): Ausleihungen, Forderungen und Verbindlichkeiten gegenüber Gesellschaftern sind gesondert auszuweisen oder im Anhang anzugeben; stehen sie unter anderen Posten, ist das zu vermerken. Die Kleinst-Bilanz fasst sie mit den übrigen zusammen, also stehen darunter „davon Ausleihungen an Gesellschafter“, „davon Forderungen gegen Gesellschafter“ und „davon gegenüber Gesellschaftern“. Dazu zählen das Gesellschafter-Verrechnungskonto und die Gesellschafterkonten des DATEV-Kontenrahmens (SKR03 0580–0582, 0730–0755, 1381–1383, 1490–1495, 1507–1508, 1650–1658, 1665–1668; SKR04 0960–0961, 1250–1255, 1307–1309, 1330–1335, 3340–3348, 3510–3519, 3640–3643), nicht stille Gesellschafter. Diese Vermerke rechnet Haben aus den Salden.

**Restlaufzeiten bestätigen:** Die Restlaufzeit steht nicht in jeder Buchung. Die Seite **Jahresabschluss** zeigt deshalb den Abschnitt **Restlaufzeiten** mit jedem Konto, das eine Forderung (Position unter den Forderungen der E-Bilanz) oder eine Verbindlichkeit ist, mit Betrag und dem Teil, der mehr als ein Jahr läuft:

- **Fest** ist der Teil bei Konten, deren Name im DATEV-Kontenrahmen die Restlaufzeit nennt (etwa SKR03 0631/SKR04 3151 „Verbindlichkeiten gegenüber Kreditinstituten – Restlaufzeit bis 1 Jahr“, 0640/3160 „1 bis 5 Jahre“), und bei Konten, deren Saldo auf der Gegenseite den Posten mindert.
- **Vorgeschlagen** wird für Forderungen und Verbindlichkeiten aus Lieferungen und Leistungen, was an offenen Rechnungen bzw. gebuchten Belegen erst mehr als ein Jahr nach dem Stichtag fällig ist (ausgestellt bis zum Stichtag, nicht bis dahin storniert, abzüglich der bis dahin zugeordneten Zahlungen und Ausbuchungen wie Skonto oder Forderungsausfall; eine Korrekturrechnung mindert den Betrag wie in den offenen Posten). Für alle anderen Konten, auch das Gesellschafter-Verrechnungskonto, kennt Haben keine Laufzeit und schlägt 0 vor: Ohne vereinbarte Zeit ist eine Leistung sofort fällig ([§ 271 Abs. 1 BGB](https://www.gesetze-im-internet.de/bgb/__271.html)). Für ein Darlehen oder eine Stundung trägst du den Teil ein, der erst nach dem 31.12. des Folgejahres fällig ist.

Hat die Bilanz eine Vorjahresspalte, steht der Vorjahresstichtag darunter; was du für das Vorjahr bestätigt hast, gilt dort schon. **Restlaufzeiten bestätigen** speichert beides für das Jahr (Tabelle `residual_terms`, mit Änderungsprotokoll). Bestätige nach den Abschlussbuchungen; ändert sich danach ein Betrag, etwa durch eine Buchung ins Jahr, sagt die Seite, dass neu zu bestätigen ist. Ohne bestätigte Restlaufzeiten fehlen sie unter der Bilanz und in der E-Bilanz, und die Bilanz zur Hinterlegung lässt sich nicht herunterladen.

> [!WARNING]
> Bilanz und GuV sind ein **Entwurf für die Steuerberatung**. Die Rückstellungen für Körperschaft- und Gewerbesteuer rechnet und bucht Haben ([unten](#körperschaft--und-gewerbesteuer-gmbh-und-ug)); andere Abschlussbuchungen wie Abschlusskosten, Rechnungsabgrenzung und Wertberichtigungen erfasst ihr vorher als [manuelle Buchung](#manuelle-und-freie-buchungen). Die Bilanz zur Hinterlegung beim Unternehmensregister erstellt Haben aus denselben Zahlen ([unten](#hinterlegung-beim-unternehmensregister-gmbh-und-ug)).

**Jahr abschließen:** Wenn die Steuerberatung den Abschluss freigegeben hat, schließt der Knopf **‹Jahr› abschließen** (etwa „2025 abschließen“) im Abschnitt **Jahr abschließen** das Jahr ab, nach einer Rückfrage mit Häkchen. Vorher muss das Jahr vorbei sein, die AfA aller Anlagen gebucht und jeder Beleg mit Datum im Jahr gebucht. Danach:

- nimmt das Jahr keine Buchung mehr an, auch keine Gegenbuchung. Das prüft das Hauptbuch und, auch für Schreiber an Haben vorbei, ein Trigger der Datenbank (`0098_jahresabschluss_trigger.sql`). Rückgängig machen lässt sich der Abschluss nicht; `year_closings` ist nur anhängbar.
- hält Haben Zahl und Prüfwert der Buchungen des Jahres fest: SHA-256 über ID und Inhalt jeder Buchung samt Zeilen, gerechnet wie ihr Siegel. Die Seite rechnet ihn bei jedem Aufruf aus den aktuellen Daten nach und zeigt, ob die Buchungen seitdem unverändert sind. Der Abschluss selbst steht mit Prüfwert im Änderungsprotokoll und damit in der Hash-Kette.

Fehler im abgeschlossenen Jahr korrigiert ihr im laufenden Jahr, wie es das Handelsrecht vorsieht.

Im Einzelunternehmen gibt es keine manuellen Buchungen. Die Anlage EÜR rechnet dort aus Rechnungen, Belegen und Zahlungen; eine Umbuchung im Journal käme in ihr nicht an.

## Hinterlegung beim Unternehmensregister (GmbH und UG)

Eine Kleinstkapitalgesellschaft (§ 267a HGB) muss ihren Jahresabschluss nicht offenlegen, sondern kann nur die Bilanz beim Unternehmensregister hinterlegen (§ 326 Abs. 2 HGB). Dritte sehen sie dann nur auf Antrag und gegen Gebühr. Die Frist endet ein Jahr nach dem Bilanzstichtag, für 2025 also am 31.12.2026 (§ 325 Abs. 1a HGB); wer sie versäumt, riskiert ein Ordnungsgeld (§ 335 HGB).

Auf der Seite **Jahresabschluss** eines vergangenen Jahres erstellt Haben dafür unter **Hinterlegung beim Unternehmensregister** die Bilanz als PDF. Die Seite nennt die Frist und weist darauf hin, solange das Jahr nicht abgeschlossen ist: Hinterlegt wird erst, wenn die Steuerberatung den Abschluss freigegeben hat, die Gesellschafter ihn festgestellt haben und das Jahr in Haben abgeschlossen ist. Danach ändert keine Buchung mehr die Zahlen.

**Was auf dem Blatt steht** (`packages/core/src/hinterlegung.ts`):

- **Firma, Sitz, Registergericht und Registernummer** (§ 264 Abs. 1a HGB) aus den [Firmendaten](einrichtung.md#firmendaten). Fehlen Registergericht oder Registernummer, ist der Download gesperrt und die Seite sagt, was fehlt.
- **Die Bilanz** in der verkürzten Form wie oben, mit der **Spalte des Vorjahres** (§ 265 Abs. 2 HGB). Die Vorjahreszahlen sind die Salden zum 1. Januar, also die Schlussbilanz des Vorjahres, ob in Haben vorgetragen oder per Eröffnungsbuchung übernommen; was im Jahr gegen 9000 Saldenvorträge übernommen ist (offene Posten aus dem Umzug, Anlagen), zählt dazu. Gibt es zum 1. Januar keine Salden (erstes Geschäftsjahr), fehlt die Spalte, und die Seite sagt das. Posten ohne Betrag in beiden Jahren entfallen (§ 265 Abs. 8 HGB), das Eigenkapital steht immer da.
- **Vermerke** unter Umlaufvermögen, Anlagevermögen und Verbindlichkeiten zu Restlaufzeiten und gegenüber Gesellschaftern, in beiden Spalten ([oben](#vermerke-unter-der-bilanz)). Solange die Restlaufzeiten nicht bestätigt sind, ist der Download gesperrt und die Seite sagt, für welchen Stichtag sie fehlen.
- Ist das Eigenkapital durch Verluste aufgebraucht, steht das Eigenkapital mit 0,00 und der Rest als **Nicht durch Eigenkapital gedeckter Fehlbetrag** am Schluss der Aktivseite (§ 268 Abs. 3 HGB).
- **Angaben unter der Bilanz**, die den Anhang ersetzen (§ 264 Abs. 1 Satz 5 HGB): Haftungsverhältnisse (§ 268 Abs. 7, § 251 HGB), etwa Bürgschaften für Dritte, und Vorschüsse und Kredite an Geschäftsführer (§ 285 Nr. 9 Buchst. c HGB). Vorgewählt ist jeweils „Keine“; gibt es welche, wählst du „Ja, folgende“ und schreibst sie so, wie sie unter der Bilanz stehen sollen. Haben übernimmt den Text unverändert und erfindet nichts. Die dritte Angabe des Gesetzes, eigene Aktien, betrifft nur die Aktiengesellschaft.
- **Tag der Feststellung** durch die Gesellschafter (§ 46 Nr. 1 GmbHG), Pflicht nach § 328 Abs. 1a und 5 HGB; er muss nach dem Stichtag liegen und darf nicht in der Zukunft liegen.
- Den Hinweis, dass die Gesellschaft eine Kleinstkapitalgesellschaft ist und keinen Anhang aufstellt.

Die GuV gehört nicht zur Hinterlegung. Die Angaben unter der Bilanz und der Tag der Feststellung werden nicht gespeichert; das PDF entsteht beim Herunterladen (`/api/hinterlegung/<jahr>`).

**Einreichen:** Das PDF lädst du auf der [Publikations-Plattform](https://www.publikations-plattform.de) als Hinterlegungsauftrag an das Unternehmensregister hoch. Für Geschäftsjahre ab 2022 gelten dafür die [Allgemeinen Nutzungsbedingungen für das Unternehmensregister](https://www.publikations-plattform.de/order/D088.pdf), nicht mehr die AGB des Bundesanzeigers für die Hinterlegung (D089), die nur noch frühere Geschäftsjahre betreffen.

- **Formate:** Direkt angenommen wird XML/XBRL nach dem Schema oder dem Webformular des Bundesanzeiger Verlags. Word, RTF, Excel und PDF wandelt das Register gegen ein Entgelt um (§ 9 der Nutzungsbedingungen). Ein PDF muss les-, kopier- und druckbar sein, den ganzen Text enthalten, darf weder verschlüsselt sein noch JavaScript oder Formulare enthalten und muss auf A4 passen, höchstens 25 MB.
- **Warum Haben ein PDF erzeugt:** Das Schema des Betreibers ist nicht öffentlich ([XML oder XBRL statt PDF](#xml-oder-xbrl-statt-pdf)). Ein PDF/A mit echtem Text, wie bei der Rechnung mit Typst gesetzt, erfüllt die Anforderungen, ist archivierbar und kommt beim Register so an, wie du es siehst. Wer die Umwandlung sparen will, tippt die Bilanz in das Webformular ab.
- **Mitteilung:** Hinterlegen darf die Gesellschaft nur, wenn sie dem Register mitteilt, dass sie zwei der drei Merkmale einer Kleinstkapitalgesellschaft (§ 267a Abs. 1 HGB) an den maßgeblichen Stichtagen nicht überschreitet (§ 326 Abs. 2 Satz 2 HGB). Das bestätigst du beim Hinterlegungsauftrag auf der Plattform.
- **Kosten:** 18,50 € Gebühr (Nr. 1420 des [Kostenverzeichnisses zum JVKostG](https://www.gesetze-im-internet.de/jvkostg/anlage.html)), für ein PDF dazu 1,75 Cent je sichtbarem Zeichen zuzüglich Umsatzsteuer ([Gebühren und Entgelte](https://www.publikations-plattform.de/order/D051Preisliste.pdf), Stand November 2026). Ein gescanntes Dokument kostet 2,50 Cent je Zeichen.

> [!WARNING]
> Prüfe das PDF vor dem Hochladen mit der Steuerberatung. Nicht abgebildet sind eine Gesellschaft in Liquidation (§ 264 Abs. 1a Satz 2 HGB) und Geschäftsjahre, die nicht am 31.12. enden.
>
> Das Eigenkapital steht als ein Posten ohne gezeichnetes Kapital: Das genügt bei der Kleinstkapitalgesellschaft (§ 266 Abs. 1 Satz 4 HGB, nur die Posten mit Buchstaben).

Gesetzestexte: [§ 264](https://www.gesetze-im-internet.de/hgb/__264.html), [§ 265](https://www.gesetze-im-internet.de/hgb/__265.html), [§ 266](https://www.gesetze-im-internet.de/hgb/__266.html), [§ 267a](https://www.gesetze-im-internet.de/hgb/__267a.html), [§ 268](https://www.gesetze-im-internet.de/hgb/__268.html), [§ 274a](https://www.gesetze-im-internet.de/hgb/__274a.html), [§ 285](https://www.gesetze-im-internet.de/hgb/__285.html), [§ 325](https://www.gesetze-im-internet.de/hgb/__325.html), [§ 326](https://www.gesetze-im-internet.de/hgb/__326.html), [§ 328 HGB](https://www.gesetze-im-internet.de/hgb/__328.html), [§ 42 GmbHG](https://www.gesetze-im-internet.de/gmbhg/__42.html).

### XML oder XBRL statt PDF

Ein PDF nimmt das Unternehmensregister nur gegen ein Entgelt für die Umwandlung an: 1,75 Cent je sichtbarem Zeichen ohne Leerzeichen zuzüglich Umsatzsteuer, zusätzlich zur Gebühr ([Gebühren und Entgelte](https://www.publikations-plattform.de/order/D051Preisliste.pdf), Abschnitt 2). Ohne dieses Entgelt angenommen werden XML oder XBRL nach den Vorgaben des Bundesanzeiger Verlags und das Webformular der Plattform ([Allgemeine Nutzungsbedingungen für das Unternehmensregister](https://www.publikations-plattform.de/order/D088.pdf), §§ 8 und 9). Wer die Umwandlung sparen will, tippt die Bilanz aus dem PDF in das Webformular ab. Haben erzeugt kein XML und kein XBRL zur Hinterlegung; geprüft im November 2026 unter **Arbeitshilfen & Standards › Technische Standards** der Publikations-Plattform:

- **XML nach dem Schema des Verlags.** Die Schemata „Bundesanzeiger“ und „Unternehmensregister“ (Stand September 2007) beschreiben ein Layout aus Überschriften, Absätzen und Tabellen. Der Download setzt eine gesonderte Freischaltung voraus, und die [Nutzungsbedingungen für die Strukturdefinitionen](https://www.publikations-plattform.de/order/de/arbeitshilfenstandards/standards/xml_schemata) (Stand 02.07.2016) erlauben sie nur, um eigene Daten oder die eigener Kunden an den Verlag zu übermitteln, und untersagen „jegliche Vervielfältigung und/oder Weitergabe“. Das Schema kann also nicht in dieses Repository, und ohne Schema lässt sich keine Datei prüfen.
- **XBRL nach der HGB-Taxonomie.** Das Register nimmt Jahresabschlüsse als XBRL 2.1 mit Dimensions 1.0 nach der HGB-Taxonomie von XBRL Deutschland an, auch in der Sicht „Einzelabschluss MicroBilG“ (`de-gaap-ci-2025-04-01-microbilg` mit `de-gcd-2025-04-01` für Version 6.9; [Arbeitshilfe für die Einreichung im XBRL-Format](https://www.publikations-plattform.de/order/D008.pdf), Stand September 2025). Das ist dieselbe Taxonomie, Version 6.9, die Haben für die [E-Bilanz](#e-bilanz-gmbh-und-ug) nutzt. Für eine Einreichung fehlt aber die Dokumentation des Verlags für Softwareanbieter, die es nur nach der Freischaltung gibt, und der Zugang zur Testplattform, den der Verlag auf Anfrage vergibt ([XBRL-Programm](https://www.publikations-plattform.de/order/de/arbeitshilfenstandards/arbeitshilfen/xbrlprogramm)). Sollen Texte wie die Angaben unter der Bilanz mit Absätzen oder Listen erscheinen, braucht es zudem das Zusatzschema „BA-Jahresabschluss-XHTML“, ebenfalls hinter der Freischaltung; XBRL-Dateien, deren gestaltete Fußnoten nicht dagegen gültig sind, nimmt der Verlag nicht an. Ohne das Zusatzschema erscheinen Texte als einfache Fußnoten (Arbeitshilfe, S. 2). Haben kennt von der Taxonomie außerdem nur einen Auszug für die Übermittlung an ELSTER, nicht ihre Dateien und Bezeichnungen. Ohne die Vorgaben und ohne Prüfung gegen die Testplattform wäre eine solche Datei geraten.

Was dafür fehlt, steht in der [Roadmap](roadmap.md#nicht-machbar-ohne-zertifizierung-oder-lizenz).

## Körperschaft- und Gewerbesteuer (GmbH und UG)

Auf der Seite **Jahresabschluss** rechnet Haben Körperschaftsteuer, Solidaritätszuschlag und Gewerbesteuer des Jahres aus dem Jahresergebnis (`packages/core/src/koerperschaft.ts`) und bucht die Rückstellungen dafür. Dazu braucht es je Jahr drei Angaben: den **Hebesatz** der Gemeinde und die **Verlustvorträge** zum 31.12. des Vorjahres für Körperschaftsteuer und Gewerbesteuer, wie sie im Bescheid stehen. Ohne gespeicherte Angaben schlägt Haben die des Vorjahres vor, mit den Vorträgen nach seiner eigenen Rechnung; speichert sie erst, wenn sie zum Bescheid passen.

| Schritt | Was Haben rechnet |
| --- | --- |
| Jahresergebnis | aus der GuV, wie im Jahresabschluss |
| + nicht abziehbare Aufwendungen | gebuchte Körperschaftsteuer und Soli (§ 10 Nr. 2 KStG), Gewerbesteuer (§ 4 Abs. 5b EStG), Steuern für Vorjahre und Erstattungen, Kapitalertragsteuer, die Konten für nicht abziehbare Geschenke, Bewirtung und Betriebsausgaben, dazu 30 % der Bewirtungskosten (§ 4 Abs. 5 Nr. 2 EStG; Haben bucht die Bewirtung voll) |
| = Einkommen | zugleich Gewinn aus Gewerbebetrieb (§ 7 GewStG) |
| − Verlustabzug | bis 1 Mio. € voll, darüber 70 % (2024 bis 2027, § 10d Abs. 2 EStG), sonst 60 % |
| Körperschaftsteuer | 15 % des zu versteuernden Einkommens in vollen Euro; Soli 5,5 % davon, Bruchteile eines Cents fallen weg |
| + Hinzurechnung § 8 Nr. 1 GewStG | ein Viertel der Summe aus Zinsen (voll, auch die zur Finanzierung des Anlagevermögens aus den [Darlehen](bank.md#darlehen)), Miete und Leasing beweglicher Wirtschaftsgüter (20 %), unbeweglicher (50 %) und Aufwand für Rechte (25 %), soweit sie 200.000 € übersteigt; gelesen aus den DATEV-Konten mit Kennzeichen G |
| − Gewerbeverlust | bis 1 Mio. € voll, darüber 60 % (§ 10a GewStG) |
| Gewerbesteuer | Gewerbeertrag auf volle 100 € abgerundet, ohne Freibetrag (Kapitalgesellschaft), Messzahl 3,5 %, mal Hebesatz |

Weil die gebuchten Steuern wieder hinzugerechnet werden, ändert eine gebuchte Rückstellung das Ergebnis nicht. **Rückstellungen zum 31.12.‹Jahr› buchen** nennt in einer Rückfrage Stichtag und Beträge und bucht dann als Umbuchung zum 31.12., was zur Steuer noch fehlt: Körperschaftsteuer und Soli an Körperschaftsteuerrückstellung (SKR03 0963, SKR04 3040), Gewerbesteuer an Gewerbesteuerrückstellung (0956 bzw. 3035). Vorauszahlungen, auf die Steueraufwandskonten gebucht (SKR03 2200, 2208, 4320; SKR04 7600, 7608, 7610), sind abgezogen; im Bankabgleich ordnest du sie als [Steuerzahlung](bank.md#steuerzahlungen) des laufenden Jahres zu. Übersteigen sie die Steuer, bucht Haben keine Erstattung; die Forderung gegen das Finanzamt bucht ihr mit der Steuerberatung. Eine Nachzahlung für ein Vorjahr verbraucht im Bankabgleich zuerst die Rückstellung dieses Jahres, der Rest geht auf die Konten für Vorjahre. Zinsen und Zuschläge zu Körperschaft- und Gewerbesteuer (SKR03 2102, 2104, 2105, 2108, 4397; SKR04 7302, 7304, 7308, 7306, 6437) rechnet die Steuerberechnung als nicht abziehbar hinzu (§ 10 Nr. 2 KStG, § 4 Abs. 5b EStG), in der Anlage GK unter den übrigen nicht abziehbaren Aufwendungen.

Im Verlustjahr lässt sich ein **Verlustrücktrag** in die zwei Vorjahre eintragen (höchstens 1 Mio. €, § 10d Abs. 1 EStG); leer bedeutet Verzicht, der ganze Verlust geht in den Vortrag. Die Gewerbesteuer kennt keinen Rücktrag.

Nicht gerechnet werden steuerfreie Erträge (§ 8b KStG), der Spendenabzug (§ 9 KStG), verdeckte Gewinnausschüttungen und Einlagen, Kürzungen nach § 9 GewStG und die Zerlegung auf mehrere Gemeinden. Hat die GmbH davon etwas, rechnet die Steuerberatung. Aus der Rechnung macht Haben auch die [Körperschaft- und Gewerbesteuererklärung](jahreserklaerung.md#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug).

## Gewinnausschüttung (GmbH und UG)

Unter **Steuern › Ausschüttungen** bucht Haben den Gewinnverwendungsbeschluss einer GmbH oder UG und meldet die Kapitalertragsteuer an. Du gibst Datum des Beschlusses, das Geschäftsjahr, dessen Gewinn ausgeschüttet wird (vorbelegt mit dem Vorjahr; es steht in der Steuerbescheinigung), den Betrag und, wenn der Beschluss einen bestimmt, den Tag der Auszahlung ein. Ohne Auszahlungstag fließt die Ausschüttung am Tag nach dem Beschluss zu (§ 44 Abs. 2 Satz 2 EStG).

**Steuerabzug je Gesellschafter** (`packages/core/src/ausschuettung.ts`). Gesellschafter, Anteile und Kirchensteuerabzugsmerkmal kommen aus den [Angaben zur Körperschaftsteuererklärung](jahreserklaerung.md#körperschaft--und-gewerbesteuererklärung-gmbh-und-ug) des Jahres.
- **Ohne Kirchensteuer:** 25 % Kapitalertragsteuer.
- **Mit Kirchensteuer:** Die Kapitalertragsteuer ist ermäßigt auf Ertrag / (4 + Kirchensteuersatz), bei 9 % also 24,45 % (§ 43a Abs. 1 Satz 2, § 32d Abs. 1 Satz 4 EStG). Die Kirchensteuer selbst beträgt 8 oder 9 % der Kapitalertragsteuer.
- **Solidaritätszuschlag:** 5,5 % der Kapitalertragsteuer.
- **Rundung:** Bruchteile eines Cents fallen weg.
- **Einlagekonto:** Was über den ausschüttbaren Gewinn hinausgeht, kommt ohne Steuerabzug aus dem steuerlichen Einlagekonto, höchstens bis zu dessen Bestand (§ 27 Abs. 1 KStG). Der ausschüttbare Gewinn ist das Eigenkapital zum Schluss des Vorjahres, abzüglich Stammkapital und Einlagekonto und abzüglich der Ausschüttungen des Jahres davor.

**Buchung** zum Datum des Beschlusses: Gewinnvortrag (SKR03 0860, SKR04 2970) an Gesellschafter-Verrechnungskonto (0730 bzw. 3510) mit der Nettodividende und an Verbindlichkeiten aus Einbehaltungen (1746 bzw. 3760) mit Kapitalertragsteuer, Soli und Kirchensteuer.
- **Grenze:** Mehr als den Gewinnvortrag zum Beschluss schüttet Haben nicht aus.
- **Auszahlung:** Die Auszahlung an die Gesellschafter ordnest du im Bankabgleich wie jede Zahlung an sie dem Gesellschafter-Verrechnungskonto zu.
- **Steuern an das Finanzamt:** Die Überweisung der einbehaltenen Steuern ordnest du als **Kapitalertragsteuer an das Finanzamt** zu.

**Kapitalertragsteuer-Anmeldung** (KapEStA, `packages/elster/src/kapesta.ts`). Sie geht über ERiC wie die Voranmeldung. Die Frist ist der 10. des Monats nach dem Zufluss, an einem Wochenende oder Feiertag der nächste Werktag; sie steht in der [Fristenliste](fristen.md). Gemeldet werden:
- Kapitalerträge, Kapitalertragsteuer und Soli;
- der Gewinnverteilungsbeschluss mit Datum, Betrag und Zufluss;
- die Kirchensteuer je Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal.

In der **Körperschaftsteuererklärung** des Jahres stehen die Ausschüttungen in der Anlage KSt 1 F (`packages/elster/src/kst1f.ts`). Dort stehen auch der ausschüttbare Gewinn und der Abzug vom Einlagekonto. Das Einlagekonto mindert sich nur um den Betrag, den die Steuerbescheinigung an die Gesellschafter als Leistung aus dem Einlagekonto ausweist (§ 27 Abs. 3 und 5 KStG). Haben setzt den berechneten Teil als bescheinigt an.

Ein **Storno** ist eine Gegenbuchung und geht nur, solange die Anmeldung nicht echt übermittelt ist. Danach korrigiert eine berichtigte Anmeldung über das ELSTER-Portal.

**Steuerbescheinigung** (§ 45a Abs. 2 EStG). Die GmbH bescheinigt jedem Gesellschafter als Schuldner der Kapitalerträge, was sie ausgeschüttet und einbehalten hat; er braucht die Bescheinigung für seine Einkommensteuererklärung. Unter jeder gebuchten Ausschüttung steht je Gesellschafter ein Link **Steuerbescheinigung … (PDF)**.
- **Muster:** Haben folgt dem amtlichen Muster II („Steuerbescheinigung einer leistenden Körperschaft, Personenvereinigung oder Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds oder eines inländischen Betreibers/einer inländischen Zweigniederlassung eines ausländischen Betreibers einer Internet-Dienstleistungsplattform“) aus dem [BMF-Schreiben vom 16. Mai 2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Abgeltungsteuer/2025-05-16-kapitalertragSt-steuerbescheinigung.pdf) (BStBl I 2025 S. 1388; das Muster allein als PDF beim [Bayerischen Landesamt für Steuern](https://www.lfst.bayern.de/fileadmin/RESSOURCEN/Formulare/Weitere_Themen_A_bis_Z/Kapitalertragsteuer/Steuerbescheinigung_Muster_II.pdf)), als Einzelsteuerbescheinigung für den Zahlungstag. Nach Rz. 1 des Schreibens darf nach Inhalt, Aufbau und Reihenfolge nicht vom Muster abgewichen werden; frei sind nur die Felder für Schuldner und Gläubiger. Inhalt in `packages/core/src/steuerbescheinigung.ts`, PDF mit derselben Vorlage wie die Mahnung in `packages/einvoice`.
- **Inhalt:** Schuldner (die Gesellschaft mit Anschrift und Steuernummer), Titel, Art der Bescheinigung, dann der Satz des Musters „An … wurden lt. Beschluss vom … am … für das Geschäftsjahr … folgende Kapitalerträge gezahlt“ mit Name, Anschrift und Identifikationsnummer des Gesellschafters. Darunter die Zeilen im Wortlaut des Musters: Kapitalerträge im Sinne des § 43 Abs. 1 Satz 1 Nr. 1 EStG, Summe Kapitalertragsteuer, Summe Solidaritätszuschlag, Summe Kirchensteuer zur Kapitalertragsteuer, bei Kirchensteuer die kirchensteuererhebende Religionsgemeinschaft mit Namen, und Leistungen aus dem steuerlichen Einlagekonto; dazu die Fußnoten des Musters zur Anlage KAP. Was aus dem Einlagekonto kommt, ist kein Kapitalertrag und steht nur in der letzten Zeile. Zeilen für andere Kapitalerträge (Zinsen, Investmenterträge, Lebensversicherungen, ausländische Steuer) lässt Haben weg, weil sie bei einer Gewinnausschüttung nicht vorkommen.
- **Woher die Angaben kommen:** Beträge, Beschluss und Geschäftsjahr aus der gebuchten Ausschüttung; Anschrift, Identifikationsnummer und Religionsgemeinschaft aus den Angaben zur Körperschaftsteuererklärung des Beschlussjahres; der Schuldner aus den Firmendaten. Ausschüttungen, die gebucht wurden, bevor Haben das Geschäftsjahr erfragt hat, bekommen keine Bescheinigung: Der Zeitraum gehört zum Inhalt von Muster II, und Rz. 1 des BMF-Schreibens erlaubt keine Abweichung. Für eine Bescheinigung die Ausschüttung stornieren und mit Geschäftsjahr neu buchen.
- **Was fehlt, steht dort:** Fehlt die Anschrift, die Identifikationsnummer (eine Steuernummer genügt nicht) oder bei Kirchensteuer der Name der Religionsgemeinschaft, zeigt Haben das statt des Links und erzeugt keine unvollständige Bescheinigung. Den Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal braucht nur die Kapitalertragsteuer-Anmeldung; die Bescheinigung verlangt den Namen.
- **Ab dem Zahlungstag:** Weil der Zahlungstag zu bescheinigen ist, gibt es die Bescheinigung erst ab dem Zufluss; zu einer stornierten Ausschüttung gibt es keine.
- **Unterschrift:** Die Bescheinigung ist maschinell erstellt und nennt den Aussteller; eine Unterschrift braucht sie dann nicht (§ 45a Abs. 2 Satz 3 EStG).
- **Übergabe und Aufbewahrung:** Gib jedem Gesellschafter seine Bescheinigung und leg eine Kopie zu den Unterlagen der Ausschüttung. Haben speichert die Bescheinigung nicht, sondern erzeugt sie bei jedem Abruf neu, mit dem Tag des Abrufs als Ausstellungsdatum. Ist eine ausgegebene Bescheinigung falsch, ersetzt die GmbH sie unverzüglich durch eine berichtigte, die als solche gekennzeichnet ist, und meldet die Berichtigung ihrem Betriebsstättenfinanzamt nach § 93c AO ([§ 45a Abs. 5 EStG](https://www.gesetze-im-internet.de/estg/__45a.html)); für eine falsche Bescheinigung haftet sie (Abs. 6). Eine berichtigte Bescheinigung erzeugt Haben nicht.

> [!WARNING]
> Haben fragt die Kirchensteuerabzugsmerkmale nicht selbst beim Bundeszentralamt für Steuern ab (KiStAM-Abfrage, jährlich zwischen 1. September und 31. Oktober); trag sie aus der Antwort ein. Nicht abgedeckt sind Ausschüttungen aus der Kapitalrücklage, verdeckte Gewinnausschüttungen, Gesellschafter im Ausland, Freistellungsaufträge und Nichtveranlagungsbescheinigungen. Die Steuerbescheinigung deckt nur Gesellschafter mit steuerlicher Identifikationsnummer ab, also natürliche Personen; für eine Gesellschaft als Gesellschafterin stellt sie die Steuerberatung aus.

## E-Bilanz (GmbH und UG)

Eine Kapitalgesellschaft übermittelt Bilanz und GuV elektronisch an das Finanzamt (§ 5b EStG), mit derselben Frist wie die Steuererklärungen. Auf der Seite **Jahresabschluss** steht dafür unten der Abschnitt **E-Bilanz**: Haben baut sie aus den Buchungen des Jahres, lässt sie von ERiC prüfen und sendet sie wie die [Jahreserklärungen](jahreserklaerung.md) mit Zertifikat und PIN.

**Taxonomie:** Für Wirtschaftsjahre bis 2026 sendet Haben in der HGB-Taxonomie 6.9, ab 2027 in der Taxonomie 6.10. Das folgt den BMF-Schreiben vom 10. Juni 2025 und 8. Juni 2026: Eine neue Taxonomie gilt grundsätzlich für Wirtschaftsjahre, die nach dem 31. Dezember des Vorjahres beginnen; für das Jahr davor ist sie nur „nicht beanstandet“. Für 2026 bleibt es deshalb bei 6.9, die jedes ERiC ab 43 prüft. Die Taxonomie 6.10 kann erst ERiC 45 prüfen, als Test; Echtfälle nimmt die Finanzverwaltung voraussichtlich ab dem ERiC-Release im Mai 2027 an. Ist ein älteres ERiC installiert (etwa 44, der Standard), nennt der Abschnitt für 2027 das als offenen Punkt und sendet nicht, bis unter **Einstellungen › ERiC** eine Version ab 45 installiert ist.

**Was gesendet wird:** ein Jahresabschluss (Einzelabschluss) nach deutschem Steuerrecht in der HGB-Taxonomie 6.9 oder 6.10, Kerntaxonomie, GuV nach dem Gesamtkostenverfahren, mit

- **Bilanz und GuV** in der Gliederung der Taxonomie. Die ist feiner als der Kleinst-Abschluss: Umsatzerlöse nach Umsatzsteuer (Regelsatz, ermäßigt, nicht steuerbar, steuerfrei), sonstige Aufwendungen nach Art (Kommunikation, Beratung, Fuhrpark, Werbung …), Anlagen nach Bilanzposition.
- **Anlagenspiegel** je Bilanzposition des Anlagevermögens aus dem [Anlagenverzeichnis](anlagen.md): Anschaffungskosten am Jahresanfang, Zugänge, Abgänge, kumulierte AfA und AfA des Jahres. Eine übernommene Anlage bringt ihre Anschaffungskosten mit, die AfA davor ist der Unterschied zum übernommenen Buchwert. GWG und Sammelposten gehen ab, sobald sie abgeschrieben sind. In 6.10 muss der Buchwert des Anlagevermögens im Anlagenspiegel dem Wert der Bilanz gleichen, auch wenn er 0 ist: Ohne Anlagen im Jahr bleibt der Anlagenspiegel dort weg, sind alle Anlagen abgeschrieben, steht das Anlagevermögen mit 0 in der Bilanz.
- **Kontennachweis:** jedes Konto mit Saldo am Jahresende einzeln, mit Nummer, Bezeichnung und Saldo auf seiner Position (§ 5b Abs. 1 EStG, für Wirtschaftsjahre ab 2025). Der Saldo steht im Vorzeichen der Position, sodass die Konten einer Position ihren Wert ergeben. Den Jahresüberschuss schließt Haben nicht auf ein Konto ab; er steht in 6.10 als Eintrag „Konto nicht vorhanden oder nicht übermittelbar“. Die Davon-Positionen zu Restlaufzeiten bekommen keinen Nachweis, weil sie in keiner Rechenregel stehen.
- **Betriebsvermögensvergleich:** Eigenkapital am Ende des Vorjahres (der EB-Wert der Eigenkapitalkonten aus Vortrag und Eröffnungsbuchung), Einlagen (Buchungen im Haben der Eigenkapitalkonten im Jahr) und Ausschüttungen (Buchungen im Soll). Er muss den Jahresüberschuss der GuV ergeben. Zahlt ihr das Stammkapital im Gründungsjahr ein, bucht das deshalb als normale Buchung, nicht als Eröffnung: Dann ist es eine Einlage und das Eigenkapital des Vorjahres null.

- **Davon-Positionen zu Restlaufzeiten**, sobald sie [bestätigt](#vermerke-unter-der-bilanz) sind: je Gruppe der Forderungen und Verbindlichkeiten (aus Lieferungen und Leistungen, gegenüber Kreditinstituten, gegenüber Gesellschaftern, sonstige) „Restlaufzeit bis 1 Jahr“ und „größer 1 Jahr“ (`upTo1year`, `above1year`) und die Summen über alle Forderungen und Verbindlichkeiten. Die Taxonomie verlangt sie nicht; ohne Bestätigung fehlen sie, und der Abschnitt weist darauf hin.

Den Kontennachweis verlangt die Taxonomie 6.10 zu jeder Position von Bilanz und GuV mit Wert, die keine Unterposition mit Wert hat (Technischer Leitfaden 6.10, Tz. B.12.1). In 6.9 sendet Haben ihn ebenso mit; dort reicht der Taxonomie ein Kontensaldo in Bilanz und GuV, und ohne Konto in der GuV, etwa in einem Jahr ohne Buchung, steht wie bisher der Vermerk, dass die Kontennachweise noch nicht übermittelt werden können. In 6.9 erlaubt das BMF-Schreiben vom 10. Juni 2025 das nur, wenn die Kontennachweise auf anderem Weg beim Finanzamt eingehen.

**Gesellschafter:** Die Stammdaten führen den Gesellschafter als Mussfeld, für eine GmbH ohne Angaben. Die neuen Prüfregeln der Taxonomie 6.10 zu Steuernummer, Identifikationsnummer und Wirtschafts-Identifikationsnummer der Gesellschafter gelten nur für Personengesellschaften (Technischer Leitfaden 6.10, Tz. B.14.3.1.19); die neue Angabe „noch nicht vergeben“ lässt Haben deshalb weg.

**Zuordnung der Konten** (`packages/core/src/ebilanz.ts`): Jedes Konto, das Haben selbst bucht, hat eine feste Position, abhängig vom Saldo wie im Kleinst-Abschluss (die überzogene Bank unter den Verbindlichkeiten gegenüber Kreditinstituten, das Gesellschafter-Verrechnungskonto im Soll unter den sonstigen Vermögensgegenständen gegen Gesellschafter). Die übrigen Gesellschafterkonten des DATEV-Kontenrahmens stehen auf den Positionen für Gesellschafter (Forderungen und Verbindlichkeiten aus Lieferungen und Leistungen gegenüber Gesellschaftern, Forderungen gegen und Verbindlichkeiten gegenüber GmbH-Gesellschaftern), weil § 42 Abs. 3 GmbHG den gesonderten Ausweis verlangt; Ausleihungen an Gesellschafter sind Anlagevermögen und brauchen den Anlagenspiegel, den Haben dafür nicht führt. Andere Konten, etwa aus einer manuellen Buchung, kommen auf die Auffangposition ihres Postens im DATEV-Kontenrahmen („nicht zuordenbar“ bzw. „übrige“). Keine Auffangposition haben Anlagevermögen, Eigenkapital und Steuern: Ein solches Konto ohne feste Position nennt der Abschnitt als offenen Punkt, und die E-Bilanz geht nicht raus, bis es umgebucht ist. Ein Test prüft jede Position gegen die Taxonomie, ein zweiter alle Konten zusammen mit dem echten ERiC.

**Ablauf:**

1. **Nur prüfen** lässt ERiC die E-Bilanz gegen Taxonomie und Plausibilitätsregeln prüfen, ohne zu senden. Das geht schon vor dem Abschluss.
2. **Prüfen und testweise senden** (mit Haken bei **Nur Testübermittlung**, vorgewählt) sendet mit Testmerker; das Finanzamt verarbeitet sie nicht.
3. **Prüfen und senden** (ohne den Haken) sendet echt; das geht erst, wenn das Jahr [abgeschlossen](#jahresabschluss-gmbh-und-ug) ist, und nur einmal. Eine berichtigte E-Bilanz geht über die Steuerberatung oder das ELSTER-Portal.

Jeder Versuch steht mit Werten und XML im Verlauf (Tabelle `annual_submissions`, Formular `ebilanz`), das Übertragungsprotokoll als PDF daneben.

> [!WARNING]
> Gesendet wird, was gebucht ist. Eine Überleitung von der Handels- zur Steuerbilanz rechnet Haben nicht. Bucht vorher die Rückstellungen für [Körperschaft- und Gewerbesteuer](#körperschaft--und-gewerbesteuer-gmbh-und-ug) und eure übrigen Abschlussbuchungen. Lasst die E-Bilanz von der Steuerberatung ansehen, bevor ihr echt sendet.

## Die Seite „Konten“

Unter **Konten** stehen oben Kacheln:
- Bankstand laut Buchungen.
- Offene Forderungen und offene Verbindlichkeiten.
- Fällige Umsatzsteuer nach Vorsteuer und Vorauszahlungen.
- Erlöse minus Aufwand im Zeitraum.

Im Einzelunternehmen rechnen Bank und Umsatzsteuer ab Jahresbeginn, ein Vortrag aus dem Vorjahr fehlt. In einer GmbH oder UG enthalten sie den [Saldenvortrag](#saldenvortrag-und-eröffnung-gmbh-und-ug).

Darunter steht die **Saldenliste**: jedes bebuchte Konto des Jahres, Quartals oder Monats mit Soll, Haben und Saldo.
- **Gruppierung:** Die Konten stehen nach Kontenklasse, also nach der ersten Ziffer der Kontonummer. Im SKR03 sind das etwa 1 Finanz- und Privatkonten, 4 Betriebliche Aufwendungen und 8 Erlöskonten. Jede Klasse hat eine Zwischensumme und lässt sich einklappen.
- **Eröffnung:** Sie ist der Saldo ab Jahresbeginn bis zum Beginn des gewählten Zeitraums, in einer GmbH oder UG dazu der Saldenvortrag aus den Vorjahren und die Eröffnungsbuchungen. Die Spalte erscheint nur, wenn es einen solchen Betrag gibt.
- **Salden in Alltagssprache:** Erlöse und Aufwand stehen als positiver Betrag. Bei Bestandskonten wie Bank, Forderungen oder Steuern steht dazu „Guthaben“ oder „Schuld“. Die Buchhaltungsseite, S für Soll und H für Haben, steht klein daneben.
- **Summe:** Soll und Haben sind in der Summe immer gleich, sonst wäre eine Buchung nicht ausgeglichen.
- **Suche:** „Konto suchen“ filtert nach Nummer oder Name.

Ein Klick auf ein Konto öffnet das **Kontenblatt**. Es zeigt:
- Eröffnung, Bewegungen und Endsaldo als Kacheln.
- Den Saldoverlauf als Diagramm. Beim Darüberfahren erscheinen Datum, Saldo und Buchung.
- Jede Buchung mit Datum, Text, Gegenkonten, Herkunft, Soll, Haben und laufendem Saldo.

Über ein Quartal oder Jahr kommt eine Zwischensumme je Monat dazu. Gegenkonten und Herkunft sind verlinkt.

Am Handy werden die Tabellen zu Karten. Das Diagramm lässt sich dort waagrecht verschieben.

Beides gibt es über „CSV“ als Datei, im selben Format wie die übrigen Exporte (Semikolon, Dezimalkomma, UTF-8 mit BOM), etwa für die Steuerberatung oder zum Abgleich mit Lexoffice.

Die CSV der Saldenliste ist zugleich die **Summen- und Saldenliste**: Nach Konto, Bezeichnung, Kontenklasse, Eröffnung, Soll und Haben im Zeitraum, Saldo und S/H folgen der EB-Wert (Saldenvortrag und Eröffnungsbuchungen, nur in GmbH und UG) und die Verkehrszahlen ab Jahresbeginn bis zum Ende des Zeitraums (Soll kumuliert, Haben kumuliert), ohne den EB-Wert.

Dasselbe Journal steht im [Jahresexport](auswertungen.md#jahresexport) als `buchungen/journal.csv`, eine Zeile je Buchungszeile, mit Buchungs-ID, Quelle, Kontenrahmen und Verweis auf die Ursprungsbuchung bei Gegenbuchungen.

## Was Haben nicht bucht

- Gebäude, Sonderabschreibungen nach § 7g EStG und Investitionsabzugsbetrag
- Fahrtenbuch und Fahrten zwischen Wohnung und Betriebsstätte; Sachentnahmen nur als [freie Buchung](#manuelle-und-freie-buchungen) ab dem Stichjahr, nicht als Kleinunternehmer
- Dreiecksgeschäfte, Konsignationslager und innergemeinschaftliches Verbringen; Einfuhrumsatzsteuer nur aus dem Bescheid des Zolls als Beleg ([Belege](belege.md#einfuhrumsatzsteuer)); innergemeinschaftliche Lieferungen und Erwerbe nur mit den Grenzen unter [Rechnungen](rechnungen.md#grenzen) und [Belege](belege.md#grenzen); § 13b als Leistungsempfänger nur für sonstige Leistungen ausländischer Unternehmer
- Lohn nur aus der [Lohnabrechnung](lohn.md#buchung), mit deren Grenzen (keine Sachbezüge, kein Zuschuss zur privaten Krankenversicherung, keine Beiträge zur Berufsgenossenschaft); Fremdwährung nur für Belege und Rechnungen (siehe [Belege](belege.md#fremdwährung) und [Rechnungen](rechnungen.md#rechnungen-in-fremdwährung)), nicht für Bank- und Verrechnungskonten
- Im Einzelunternehmen Abschlussbuchungen und Saldenvorträge zum Jahreswechsel (außer für übernommene offene Posten); in GmbH und UG trägt Haben die Salden [vor](#saldenvortrag-und-eröffnung-gmbh-und-ug), einzelne Abschlussbuchungen lassen sich [manuell](#manuelle-und-freie-buchungen) erfassen

> [!NOTE]
> Haben ersetzt keine Steuerberatung. Arbeitet die Steuerberatung mit den Daten weiter, bekommt sie das Journal aus dem Jahresexport; die Kontenzuordnung sollte einmal mit ihr abgestimmt werden.
