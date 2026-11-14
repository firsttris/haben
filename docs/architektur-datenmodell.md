---
title: "Datenmodell von Haben: Tabellen und ihr Schutz"
description: >-
  Alle Tabellen von Haben mit Zweck und Schutz durch Trigger: Stammdaten, Rechnungen, Belege,
  Buchhaltung, Bank, Umsatzsteuer, Lohn, Archiv und Protokoll.
---

# Datenmodell

Alle Tabellen stehen in `apps/web/src/server/db/schema.ts`. Beträge sind ganze Cent, Steuersätze Basispunkte. Die Spalte „Schutz“ fasst die Trigger aus `apps/web/drizzle/` zusammen; Einzelheiten in [Buchhaltung in Haben](buchhaltung.md#gobd-unveränderbarkeit-in-der-datenbank).

## Stammdaten

| Tabelle | Zweck | Schutz |
| --- | --- | --- |
| `year_closings` | Abgeschlossene Geschäftsjahre (GmbH, UG) mit Zahl und Prüfwert der Buchungen | Nur anhängen; Buchungen mit Datum in einem abgeschlossenen Jahr abgelehnt; Audit |
| `company` | Firmendaten mit Gläubiger-ID für Lastschriften, Rechtsform, Versteuerungsart, Kontenrahmen, Zahlungsziel, Rechnungsformat, Standard-Einleitung für Rechnungen und Angebote, Zeichen in der Navigation (`nav_color`, `nav_logo`); genau eine Zeile | Kontenrahmen, Versteuerung und Einschalten von § 19 gesperrt, sobald im laufenden Jahr gebucht ist; Rechtsform ab der ersten Buchung irgendeines Jahres oder einer festgeschriebenen neuen Anzahlungsanforderung im Bilanzverfahren, Kontenrahmen bei GmbH und UG ab der ersten Buchung; Löschen ab der ersten Buchung abgelehnt, damit Löschen und neu Anlegen danach die Sperren nicht umgeht; `nav_color` nur `#RRGGBB` in Großbuchstaben; Audit |
| `elster_certificates` | ELSTER-Zertifikatsdatei, verschlüsselt; auf Wunsch die PIN für den automatischen Postfachabruf, ebenfalls verschlüsselt | Audit ohne Chiffrat und PIN |
| `contacts` | Kunden und Lieferanten, mit Herkunft aus Lexoffice; DATEV-Debitor und -Kreditor (`debitor_nr`, `kreditor_nr`, eindeutig, Bereich per CHECK) | nicht löschbar, versioniert, Audit |
| `contact_versions` | Stand eines Kontakts je Version | nur anhängen |
| `contact_persons` | Ansprechpartner eines Kontakts (#424): Name, E-Mail, Telefon, Funktion, `deactivated_at`. Änderbar, nicht löschbar (Trigger vor `DELETE` und `TRUNCATE`), deaktivieren statt löschen. `invoices.contact_person_id` und `quotes.contact_person_id` halten die Auswahl im Entwurf, der festgeschriebene Stand steht als `ansprechpartner` im Käufer des Belegs (`buyer`) | Audit |
| `sepa_mandates` | SEPA-Lastschriftmandate eines Kunden (#445): Mandatsreferenz (eindeutig ohne Rücksicht auf Groß- und Kleinschreibung), Datum der Unterschrift, CORE oder B2B, Sequenz des ersten Einzugs aus Haben (`FRST` oder `RCUR`), letzter Einzug vor Haben, Kontoinhaber, IBAN, BIC; der Verfall nach 36 Monaten ohne Einzug folgt aus `mandatStatus` in `packages/core` | nur anhängen, Audit |
| `sepa_mandate_files` | Unterschriebenes Mandat als PDF im Dokumentenspeicher (SHA-256); das jüngste gilt | nur anhängen, Audit |
| `sepa_mandate_revocations` | Widerruf eines Mandats mit Tag und Grund; je Mandat höchstens einer | nur anhängen, Audit |
| `datev_personenkonten` | Debitoren und Kreditoren, die ein DATEV-Export geschrieben hat, je Kontakt und Rolle die erste Ausgabe; ab dann ist die Nummer am Kontakt fest (Trigger auf `contacts`) | nur anhängen, Audit |
| `bank_accounts` | Bankkonten, über die IBAN zugeordnet; `excluded_at` markiert ein Konto, das nicht zu dieser Firma gehört (ausgeblendet, kein Abruf, kein Import; nur ohne zugeordneten, verrechneten oder ausgebuchten Umsatz, ein Trigger prüft es) | Audit |
| `company_logo` | Aktuelles Firmenlogo (PNG oder JPEG) für Rechnungen, Angebote und Mahnungen; höchstens eine Zeile | Audit ohne Bilddaten (mit SHA-256) |
| `letterhead_background` | Aktuelles Briefpapier (PNG oder JPEG, aus einem PDF die erste Seite als Bild) hinter den Belegen; höchstens eine Zeile | Audit ohne Bilddaten (mit SHA-256) |
| `beleg_layouts` | Eigene Belegvorlagen (#113): Name, Art (`beleg` oder `mahnung`), Typst-Quelltext, SHA-256, Version des Feldvertrags, Pakete und `approved_sha256` (Freigabe der Pakete für genau diesen Quelltext); Paket-Cache je Layout unter `DOCUMENTS_DIR/vorlagen/<id>/pakete` | Audit mit Quelltext |
| `letterhead_profiles` | Gestaltung der Belege als JSON (`settings`: Layout je Belegart, Akzentfarbe, Logo-Größe und -Seite, Schalter, eigene Fußzeile); heute genau ein Standardprofil (`is_default`), ohne Zeile gelten die Vorgaben aus `packages/core` | höchstens ein Standardprofil, Akzentfarbe nur `#RRGGBB`, Audit |
| `custom_pages` | [Eigene Seiten](eigene-seiten.md): Name, Adresse und ob der Menüeintrag die Seite im Rahmen zeigt oder in einem neuen Tab öffnet (`open_in_new_tab`) | Audit |
| `exchange_rates` | Umsatzsteuer-Umrechnungskurse (§ 16 Abs. 6 UStG) je Währung und Monat, vom BMF abgerufen oder von Hand eingetragen; Belege und Rechnungen speichern ihren Kurs selbst | Audit |

## Rechnungen und Belege

| Tabelle | Zweck | Schutz |
| --- | --- | --- |
| `invoices` | Ausgangsrechnungen, Stornos und Korrekturen mit PDF, XML, SHA-256 und umsatzsteuerlicher Behandlung (`tax_treatment`, `exemption_reason`); Bestell-, Auftrags- und Lieferscheinnummer (`buyer_order_reference`, `seller_order_reference`, `despatch_advice_reference`, BT-13, BT-14, BT-16; leer = keine, ab `0160`); aus Vorlagen mit `recurring_id` und Termin (`recurring_date`, eindeutig je Vorlage); höchstens ein festgeschriebenes Storno je Rechnung; Gesamtrabatt wie eingegeben (`discount_percent` oder `discount_amount`), der Abzug je Satz folgt aus Zeilennetto minus `invoice_taxes.base`; Abschlag zu einer Zeile des Zahlungsplans (`payment_plan_row`); externe Referenz aus der REST-API (`external_source`, `external_id`, nur zusammen und zusammen eindeutig); Zahlungsart Überweisung oder Lastschrift mit Mandat (`payment_method`, `sepa_mandate_id`, nur zusammen, ab `0181`) | gesperrt ab Festschreibung, Audit ohne PDF/XML |
| `recurring_invoices` | Vorlagen für wiederkehrende Rechnungen: Positionen (JSON, mit `detail` für den Text zur Position), Intervall, nächster Termin, Modus (Entwurf oder festschreiben), Zahlungsart (`payment_method`; bei Lastschrift das jüngste am Fälligkeitstag gültige Mandat je Lauf) | Audit |
| `dunnings` | Zahlungserinnerungen und Mahnungen mit Stufe, Frist, Gebühr, Pauschale, Zinsen und PDF | nur anhängen, Audit ohne PDF |
| `invoice_lines` | Positionen einer Rechnung: Bezeichnung (`description`), optionaler mehrzeiliger Text (`detail`, BT-154), Artikelnummer (`item_number`, BT-155, aus dem Artikel kopiert, ab `0162`), Einzelpreis wie eingegeben (netto oder brutto, `invoices.price_mode`), Positionsrabatt wie eingegeben (`discount_percent` oder `discount_amount`), Zeilennetto nach Rabatt | gesperrt mit der Rechnung |
| `invoice_taxes` | Netto und Umsatzsteuer je Steuersatz, einmal beim Speichern des Entwurfs berechnet; Voranmeldung, Zahlungsbuchung, Auswertungen, Schlussrechnung, PDF und XML lesen nur diese Werte | gesperrt mit der Rechnung |
| `invoice_attachments` | Zusätzliche PDF-Anhänge einer Rechnung (#272): Dateiname, Größe, SHA-256 der Datei im Dateisystem (wie bei Belegen); je Rechnung jede Datei höchstens einmal. PDF und XML der Rechnung bleiben unberührt | gesperrt mit der Rechnung, im Siegel der Rechnung (Siegel ab `0125`), Audit |
| `invoice_number_counters` | Letzte vergebene Nummer je Jahr | darf nicht sinken, Audit |
| `quotes` | Angebote mit Gültigkeit, PDF, SHA-256, Bestell-, Auftrags- und Lieferscheinnummer wie bei `invoices`, Gesamtrabatt, Zahlungsplan (`payment_plan`, JSON) und ob er in die Auftragsbestätigung kommt, Antwort des Kunden (`decision`) und daraus entstandener Rechnung (`invoice_id`) | gesperrt ab Festschreibung bis auf Antwort und Rechnung, Audit ohne PDF |
| `quote_lines` | Positionen eines Angebots: Bezeichnung (`description`), optionaler mehrzeiliger Text (`detail`), Artikelnummer (`item_number`), Positionsrabatt, Art (`kind`: optional oder Alternative zur Position davor, sonst zählt sie zur Summe) | gesperrt mit dem Angebot |
| `quote_attachments` | Zusätzliche PDF-Anhänge eines Angebots (#415), wie `invoice_attachments`: Dateiname, Größe, SHA-256 der Datei im Dateisystem; je Angebot jede Datei höchstens einmal. Das PDF des Angebots bleibt unberührt | gesperrt mit dem Angebot (kein Siegel, wie das Angebot), Audit |
| `quote_default_attachments` | Standardanhänge für Angebote (#415) aus den Einstellungen: Dateiname, Größe, SHA-256; jedes neue Angebot bekommt sie als Zeilen in `quote_attachments` | änderbar, Audit |
| `quote_choices` | Auswahl des Kunden: gewählte optionale und alternative Positionen eines festgeschriebenen Angebots | nur anlegen und löschen, fest ab der ersten festgeschriebenen, nicht stornierten Rechnung zum Angebot, Audit |
| `quote_number_counters` | Letzte Angebotsnummer je Jahr (`AN-2026-001`) | darf nicht sinken, Audit |
| `documents` | Eingangsbelege; Datei im Dateisystem, Felder aus Auslesung oder Hand, beim Buchen festgehalten, ob mit Vorsteuerabzug (`vorsteuer_abzug`) und ob die Gutschrift schon bezahltes Entgelt erstattet (`erstattet_bezahltes`, dann liegt die Vorsteuer bis zum Ausgleich auf dem Zwischenkonto, #786); externe Referenz aus der REST-API (`external_source`, `external_id`, nur zusammen und zusammen eindeutig); bei einer Neuerfassung der stornierte Beleg (`replaces_document_id`). Die Datei (`sha256`) ist eindeutig außer bei Neuerfassungen, je storniertem Beleg höchstens eine | gesperrt ab Buchung, Audit |
| `document_amounts` | Beträge eines Belegs je Steuersatz | gesperrt mit dem Beleg |
| `recurring_documents` | Dauerbelege: Vorlage für wiederkehrende Ausgaben mit Lieferant, Kategorie, Beträgen je Satz (JSON), Steuerausweis des Dokuments (`tax_shown`), Intervall, Ankertag, nächstem Termin, Ende, Zahlungsziel in Tagen, Status (aktiv, pausiert, beendet) und dem Vertrag im Dokumentenspeicher (SHA-256). Die Belege daraus tragen `documents.recurring_document_id` und `recurring_period` (Monatserster des Termins), zusammen eindeutig; sie nutzen alle die Datei der Vorlage beim Anlegen, deshalb gilt der eindeutige Index auf `documents.sha256` nur außerhalb von Neuerfassungen und Dauerbelegen | änderbar, Audit; die Belege selbst wie jeder Beleg |
| `document_splits` | Aufteilung eines Belegs auf mehrere Kategorien (#271): Kategorie, Steuersatz, Netto und anteilige Vorsteuer je Zeile (`allocateSplitTax` in `packages/core/src/document-split.ts`); ohne Zeilen gilt `documents.category`, mit Zeilen ist sie leer. Je Satz ergeben die Zeilen Netto und Vorsteuer aus `document_amounts`, die maßgeblich bleiben | gesperrt mit dem Beleg, Teil seines Siegels (ab `0129`; ältere Siegel ohne den Schlüssel bleiben gültig), Audit |
| `document_cancellations` | Storno eines gebuchten Belegs: Beleg, Gegenbuchung, Datum der Gegenbuchung (im noch nicht gemeldeten Zeitraum der Belegbuchung deren Datum, sonst Tag des Stornos), Grund; je Beleg höchstens einer. Der Beleg selbst bleibt unverändert; Voranmeldung und EÜR zählen den Storno an diesem Datum, offene Posten und Bankabgleich lassen den Beleg weg (`documentNotCancelled`) | nur anhängen, Audit, Siegel |
| `articles` | Artikel und Leistungen zum Einfügen in Rechnungen und Angebote: Bezeichnung (`description`), optionaler mehrzeiliger Text (`detail`), Preis netto oder brutto (`price_includes_tax`), Steuersatz, archivierbar | änderbar, Audit |
| `text_blocks` | Textbausteine: Kopf- oder Fußtext zum Einfügen in Rechnungen, Angebote und wiederkehrende Rechnungen, optional einem Kunden zugeordnet, archivierbar; eingefügt wird eine Kopie | änderbar, Audit |

## Buchhaltung, Bank und Umsatzsteuer

| Tabelle | Zweck | Schutz |
| --- | --- | --- |
| `journal_entries` | Buchungen mit Herkunft (Rechnung, Beleg, Zuordnung, Lohnabrechnung …) und Verweis auf die stornierte Buchung | geschrieben nur von `ledger.post`; gesperrt ab Entstehung, Soll = Haben beim Sperren (festgeschrieben wird erst nach den Zeilen), beim Commit festgeschrieben, Kontenrahmen = Firmendaten, Audit |
| `journal_lines` | Buchungszeilen mit Konto, Soll, Haben, Steuerschlüssel | gesperrt mit der Buchung |
| `own_accounts` | Eigene Sachkonten (#270): Aufwandskonto mit eigener Nummer und eigenem Namen je Kontenrahmen, `parent_category` ist die Elternkategorie, auf die Auswertungen nach Kontonummer es auflösen. Archivieren statt löschen, sobald im Journal oder an einem Beleg gebucht ist; `documents.own_account_id` und `document_splits.own_account_id` verweisen darauf, `category` bleibt die Elternkategorie | Nummer, Kontenrahmen und Elternkategorie fest (`0211`), Audit, Sperre gegen `TRUNCATE` |
| `cash_entries` | Kassenbuch: jede Bewegung der Barkasse mit lückenloser Nummer, Beleg oder Art (Einlage, Entnahme, Geldtransit, Bareinnahme auf eine Rechnung mit `invoice_id` und Steueranteil wie bei `allocations`, Bareinnahme ohne Rechnung mit Behandlung und Satz in `tax_treatment`, `tax_rate`, nur zusammen und nur dort), Buchung; Storno als Gegenzeile | nur anhängen, Bareinnahme nur auf eine festgeschriebene Rechnung, Audit |
| `bank_imports` | Jede importierte Auszugsdatei mit SHA-256, Zeitraum, Salden | nur anhängen, Audit |
| `bank_transactions` | Importierte Umsätze mit Hash zur Deduplizierung; EndToEndId, soweit der Auszug sie nennt | nur anhängen |
| `sepa_transfers` | Erzeugte SEPA-Dateien (pain.001) mit Auftraggeberkonto, Ausführungsdatum, Anzahl, Summe und XML | nur anhängen, Audit |
| `sepa_transfer_items` | Je Beleg eine Überweisung der Datei: EndToEndId (eindeutig), Betrag, Skonto, Empfänger, IBAN, Verwendungszweck | nur anhängen, Audit |
| `sepa_direct_debits` | Erzeugte Lastschriftdateien (pain.008, #445) mit Gläubigerkonto, Anzahl, Summe und XML | nur anhängen, Audit |
| `sepa_direct_debit_items` | Je Rechnung eine Lastschrift der Datei: Mandat, Sammler (`payment_info_id`), EndToEndId (eindeutig), Verfahren, Sequenz (FRST, RCUR), Einzugstag, Betrag, Konto, Verwendungszweck; zählt für den Verfall des Mandats | nur anhängen, Audit |
| `document_iban_decisions` | Entscheidung je Beleg, welche IBAN gilt, wenn die E-Rechnung (BT-84) eine andere nennt als der Kontakt (#410): Kontakt- und Rechnungs-IBAN beim Entscheiden, Wahl (`kontakt` oder `e-rechnung`), Person; die jüngste passende gilt | nur anhängen, Audit |
| `bank_connections` | Zustimmungen für den Kontoabruf über Enable Banking: Bank, Status, Ablauf, beim Verbinden gewählter Abrufbeginn, freigegebene Konten mit Abrufstand; Sitzungskennung verschlüsselt | Audit ohne Chiffrat |
| `allocations` | Zuordnung eines Umsatzes (ganz oder teilweise); `date` ist der Tag, an dem sie wirkt, leer heißt Buchungsdatum des Umsatzes und ist bei der Gegenzeile einer Aufhebung gesetzt (#782, ab `0228`); aufgehoben per Gegenzeile; bei „Umsatzsteuer an das Finanzamt“ der Bezug auf die Voranmeldung (`vat_return_id`, offener Posten); bei einer Steuerzahlung Steuerart, Bezugsjahr und Teil (`tax_type`, `tax_year`, `tax_item`, nur zusammen und nur dort); bei einem Darlehen das Darlehen und der Teil (`loan_id`, `loan_part`); bei einer Direktbuchung auf eine Kategorie (#324) Kategorie und Steuersatz (`category`, `tax_rate`, nur zusammen und nur dort); bei einer Rücklastschrift die zurückgegebene Lastschrift (`direct_debit_item_id`, nur an Zuordnungen auf eine Rechnung, ab `0184`) | nur anhängen, Betragsprüfung, Bezug nur zu einer abgegebenen Voranmeldung, Audit |
| `bank_neutralizations` | Verrechnung zweier gegenläufiger Umsätze desselben Kontos, die zusammen null ergeben (#457), mit Notiz und Person; keine Buchung, der Bankabgleich (`db/bank-open.ts`, Funktion `haben_bank_neutralized`) zählt beide als erledigt; aufgehoben per Gegenzeile (`reverses_id`, höchstens eine) | nur anhängen, Trigger prüft Konto, Summe, keine Zuordnung und höchstens eine gültige Verrechnung je Umsatz; Zuordnung auf einen verrechneten Umsatz lehnt ein Trigger ab; Audit |
| `write_offs` | Ausbuchung des Rests einer Rechnung oder eines Belegs: gewährtes oder erhaltenes Skonto, Forderungsausfall, Kursdifferenz; zählt wie eine Zahlung, bewegt aber kein Geld; aufgehoben per Gegenzeile | nur anhängen, Audit |
| `document_settlements` | Verrechnung zweier Eingangsbelege desselben Lieferanten ohne Zahlung (#274): zwei Zeilen je Verrechnung, Betrag mit Vorzeichen, ein Tag der Aufrechnung, Aufhebung per Gegenzeile; zählt in EÜR, Abgleich, Restlaufzeiten und Archiv wie eine Zahlung, bucht aber nichts | nur anhängen, Audit, TRUNCATE gesperrt, Betrag ungleich null, zwei verschiedene Belege, Aufhebung höchstens einmal je Paar |
| `loans` | Aufgenommene Darlehen: Name, Geber, Restlaufzeit, Verwendung, Restschuld zum Stichtag bei Übernahme; Bestand aus den Zuordnungen | Geber, Restlaufzeit, Verwendung und Restschuld fest nach der ersten Zuordnung (Trigger), Audit |
| `vat_returns` | Voranmeldungen je Monat oder Quartal mit Kennzahlen (seit `0153` auch Kz 62, Einfuhrumsatzsteuer), berechnet oder überschrieben; `month` hält den Zeitraum-Schlüssel aus ELSTER (1–12 Monate, 41–44 Quartale) | gesperrt nach Echtübermittlung oder Abgabevermerk, Audit |
| `vat_return_filings` | Abgabevermerk einer außerhalb von Haben abgegebenen Voranmeldung: Tag, Transferticket, Kz 83 laut Protokoll, Protokoll-PDF im Dokumentenspeicher (SHA-256); je Anmeldung höchstens einer | nur anhängen, nur zusammen mit der Festschreibung der Anmeldung in derselben Transaktion, mit deren Transferticket und Kz 83 (beim Commit geprüft), im Siegel der Voranmeldung (Siegel ab `0138`), Audit |
| `vat_frequencies` | Voranmeldungszeitraum ab Jahr und Quartalsbeginn: monatlich, vierteljährlich oder keine Voranmeldung | Audit |
| `vat_extensions` | Dauerfristverlängerung je Jahr mit angemeldeter Sondervorauszahlung, aus der Echtübermittlung oder von Hand | Audit |
| `vat_extension_submissions` | Prüfungen und Übermittlungen des Antrags auf Dauerfristverlängerung (USt 1 H) mit XML und Protokoll | nur anhängen, Audit ohne PDF |
| `zm_submissions` | Prüfungen und Übermittlungen der Zusammenfassenden Meldung je Quartal mit den gemeldeten Zeilen, XML und Protokoll; Berichtigungen als neue Zeile | nur anhängen, Audit ohne PDF |
| `vat_items_since` | Stichtag der offenen Posten aus Voranmeldungen: Zeitpunkt der Migration `0138`. Vorher gesendete Voranmeldungen sind nur mit einer Zahlung mit Bezug ein Posten (`ohneAltbestand` in `packages/core/src/ustva-posten.ts`) | eine Zeile, nur anhängen, Audit |
| `vat_return_submissions` | Jede Prüfung und Übermittlung mit XML und Protokoll-PDF | nur anhängen, Audit ohne PDF und XML |
| `elster_messages` | Nachrichten an das Finanzamt (Sonstige Nachricht, Änderung der Bankverbindung) mit Text, Werten und XML | nur anhängen, Audit ohne XML |
| `postfach_requests` | Abrufe des ELSTER-Postfachs und Bestätigungen der Abholung mit XML | nur anhängen, Audit ohne XML |
| `postfach_documents` | Abgeholte Bescheide und Mitteilungen, Datei im Dokumentenspeicher | nur anhängen, Audit |
| `vast_requests` | Belegabrufe (Liste und Abholung) mit XML, je Person und Jahr | nur anhängen, Audit ohne XML |
| `enable_banking_settings` | Zugang zu Enable Banking (eine Zeile): Application ID, privater Schlüssel verschlüsselt; geht vor den Umgebungsvariablen | Audit ohne Schlüssel |
| `store_connections` | Zugänge zu den Finanzberichten von Google Play und App Store Connect, eine Zeile je Store: Angaben ohne Geheimnis, Servicekonto-JSON bzw. .p8 verschlüsselt, Stand des Abrufs | Audit ohne Schlüssel |
| `mail_settings` | Zugang für E-Mails (eine Zeile): Versandweg `smtp` (Server, Port, Benutzer) oder `graph` (Tenant, Client, Anmeldeart, Fingerabdruck des Zertifikats, Postfach); das eine Geheimnis (SMTP-Passwort, Client Secret oder privater Schlüssel des Zertifikats) liegt verschlüsselt in `ciphertext`; Einstellungen der Erinnerungen und der wöchentlichen Mail mit dem Prüfwert des Audit-Logs; ein CHECK sichert die Spalten des gewählten Weges | Audit ohne Geheimnis |
| `inbox_settings` | IMAP-Zugang für Belege per E-Mail (Passwort verschlüsselt), Ordner, letzter Abruf und Fehler | Audit nur bei Änderungen am Zugang, ohne Passwort |
| `inbox_messages` | Abgerufene Mails je Message-ID mit angelegten Belegen, Dubletten und übersprungenen Anhängen | nur anhängen, Audit |
| `mail_log` | Gesendete E-Mails mit Versandweg (`smtp` oder `graph`), Empfänger, Blindkopie, Anhängen, Fehler, Bezug zu Rechnung, Mahnung bzw. Angebot und den erinnerten Fristen (Schlüssel Frist:Stufe) | nur anhängen, Audit |
| `brm_requests` | Anträge, Freischaltungen, Widerrufe und Listen der Abrufberechtigung mit XML (ohne Freischaltcode); der Stand ergibt sich aus dem Verlauf | nur anhängen, Audit ohne XML |
| `vast_belege` | Abgeholte, entschlüsselte Belege (Lohnsteuerbescheinigung, Rentenbezüge, Beiträge …) als XML | nur anhängen, Audit ohne XML |
| `dividends` | Gewinnausschüttungen einer GmbH oder UG: Beschluss, Zufluss, Bruttobetrag, Steuerabzug je Gesellschafter (JSON), Buchung; Storno per Gegenbuchung | nur anhängen, Audit |
| `kapest_submissions` | Prüfungen und Übermittlungen der Kapitalertragsteuer-Anmeldung je Ausschüttung mit XML und Protokoll-PDF; höchstens eine erfolgreiche Echtübermittlung | nur anhängen, Audit ohne PDF |
| `residual_terms` | Restlaufzeiten der Forderungen und Verbindlichkeiten einer GmbH oder UG je Jahr als JSON: je Konto Betrag beim Bestätigen und Teil über einem Jahr, für den Stichtag und die Vorjahresspalte (§ 268 Abs. 4 und 5 HGB) | änderbar, Audit |
| `corporate_tax_inputs` | Angaben einer GmbH oder UG zu Körperschaft- und Gewerbesteuer je Jahr als JSON: Hebesatz, Verlustvorträge, Rücktrag, unter `erklaerung` Anteilseigner, Verträge, Gründung, Einlagekonto | änderbar, Audit |
| `annual_submissions` | Prüfungen und Übermittlungen der Jahreserklärungen (Formulare `ust`, `euer`, `est`, `kst`, `gewst`) und der E-Bilanz (`ebilanz`) mit Werten, XML und Protokoll-PDF; höchstens eine erfolgreiche Echtübermittlung je Erklärung und Jahr | nur anhängen, Audit ohne PDF und XML |
| `income_tax_inputs` | Angaben zur Einkommensteuererklärung je Jahr (Vorsorge, Sonderausgaben, Kinder, KAP) | änderbar, Audit |
| `pauschalen` | Pauschalen ohne Beleg (Homeoffice, Fahrt, Verpflegung, Wege zur Betriebsstätte) mit Angaben, Betrag und Buchung; Storno als Gegenzeile | nur anhängen, Audit |
| `assets` | Anlagenverzeichnis: Art, Abschreibung, Anlagekonto, Anschaffung, Nutzungsdauer, degressiver Satz, Wechsel zur linearen AfA, Erinnerungswert, Übernahme, Abgang | Grundlagen fest nach der ersten Buchung (Wechsel zur linearen AfA nur in ein noch nicht gebuchtes Jahr), Audit |
| `asset_depreciations` | Gebuchte AfA je Anlage und Jahr mit Verweis auf die Buchung | nur anhängen, Audit |

## Lohn

| Tabelle | Zweck | Schutz |
| --- | --- | --- |
| `employees` | Mitarbeiter: Person, Lohnsteuerabzugsmerkmale, Kranken- und Pflegeversicherung, Meldedaten, Monatsgehalt, Eintritt und Austritt, Statusfeststellung des Gesellschafter-Geschäftsführers; fortlaufende Personalnummer | änderbar, Audit |
| `payroll_runs` | Lohnlauf je Monat mit Zahltag | Audit |
| `payslips` | Abrechnung je Mitarbeiter und Monat: Stand der Stammdaten (JSON), Bestandteile, Brutto, Steuern, SV-Anteile mit Einzelheiten, Netto, Auszahlung, Stufe, gegengeprüft; beim Festschreiben PDF und SHA-256; bei einer Korrektur die stornierte (`replaces_id`) | Entwurf änderbar; ab `locked_at` gesperrt und versiegelt; je Mitarbeiter und Monat höchstens eine nicht stornierte (Trigger); Audit ohne PDF |
| `payslip_cancellations` | Storno einer festgeschriebenen Abrechnung mit Tag und Grund; je Abrechnung höchstens eines | nur anhängen, nur für festgeschriebene, Audit, Siegel |
| `lsta_turnus` | Anmeldungszeitraum der Lohnsteuer je Jahr, wenn der Nutzer ihn abweichend vom Vorschlag festlegt | änderbar, Audit |
| `lsta_submissions` | Prüfungen und Übermittlungen der Lohnsteuer-Anmeldung je Zeitraum mit gemeldeten Kennzahlen (JSON), berichtigt, XML, Antwort und Protokoll-PDF | nur anhängen, Audit ohne PDF |
| `lstb_submissions` | Lohnsteuerbescheinigung je Mitarbeiter und Jahr: jede Prüfung und Übermittlung über ERiC und jeder Vermerk einer Übermittlung im ELSTER-Portal, mit Art (neu, Korrektur, Storno), KmId und Verweis auf die vorige, Werten, Angaben, Transferticket und XML | nur anhängen, je echt gesendeter KmId eine Zeile, Audit ohne Protokoll-PDF |
| `sv_portal_filings` | Vermerke „im SV-Meldeportal abgegeben“ je Beitragsnachweis oder Meldung (`gegenstand`): Tag, Werte der Ausfüllliste beim Vermerk (JSON), Notiz, Protokoll im Dokumentenspeicher (SHA-256, Name, Typ, Größe); eine Rücknahme ist eine neue Zeile mit `revokes_id` | nur anhängen, Rücknahme nur einmal und nur zum selben Gegenstand (Trigger), Audit |

## Archiv und Umzug

| Tabelle | Zweck | Schutz |
| --- | --- | --- |
| `archive_files` | Originalexporte (DATEV, IDEA, ELSTER-Protokolle, Kontoauszüge) unter SHA-256 | nur anhängen, Audit |
| `store_reports` | Abgerufene Finanzberichte der App-Stores je Store, Monat und Teil, mit Verweis auf die Originaldatei in `archive_files` | nur anhängen, Audit |
| `store_payouts` | Übernommene Auszahlungen der App-Stores: Bankeingang, angelegte Auszahlung und Kursdifferenz im Konto des Stores, bezahlte Monatsumsätze | nur anhängen, Audit |
| `datev_bookings` | Zeilen eines DATEV-Buchungsstapels, unverändert | nur anhängen |
| `lexoffice_connection` | API-Schlüssel für Lexware Office, verschlüsselt; eine Zeile | Audit ohne Chiffrat |
| `sevdesk_connection` | API-Token für sevDesk, verschlüsselt, mit Buchhaltungsversion; eine Zeile | Audit ohne Chiffrat |
| `lexoffice_imports` | Läufe aller Umzugsquellen (`source`: Lexoffice, sevDesk, BuchhaltungsButler, Accountable, lokale Paketübernahme) mit Fortschritt; höchstens ein Lauf zugleich | Audit beim Anlegen |
| `lexoffice_vouchers` | Rechnungen und Belege aller Umzugsquellen (`source`) mit vollständiger Quellantwort beziehungsweise Originalpaket | nur anhängen |
| `lexoffice_voucher_files` | Dateien zu einem Lexoffice-Beleg | nur anhängen |
| `legacy_voucher_payments` | Belegte Einzelzahlungen aus sevDesk oder lokalen Paketen mit Datum, Betrag, Konto und Herkunft; eindeutig je Zuordnung | nur anhängen, Audit |
| `sevdesk_accounting_types` | Kontostamm der Buchungskonten aus sevDesk (`GET /AccountingType/{id}`), unverändert; eindeutig je Konto und Stand | nur anhängen, Audit, TRUNCATE gesperrt |
| `legacy_order_documents` | Angebote, Auftragsbestätigungen und Lieferscheine aus sevdesk oder lokalen Paketen mit Positionen und Quelldaten; ohne Buchungswirkung | nur anhängen, Audit |
| `legacy_order_pdf_attempts` | Vorher-/Nachher-Quellantworten und Ergebnis automatischer V1-Auftrags-PDF-Abrufe | nur anhängen, Audit |
| `legacy_order_files` | Automatisch abgerufene oder manuell nachgereichte Original-PDFs zu Auftragsdokumenten mit Prüfsumme und Zeitpunkt | nur anhängen, Audit |
| `external_imports` | Quellidentität und Inhaltshash eines lokalen Paketvorgangs mit genau einem Verweis auf Originalbeleg, Auftragsdokument oder Journalbuchung; keine eigene Zahlungs-/EÜR-Quelle | nur anhängen, Audit; vorhandene Herkunft nicht per TRUNCATE leerbar |
| `external_import_settlements` | Bestätigter Bezug einer importierten Zahlungsbuchung zur ursprünglichen OP-Buchung derselben Quelle; ohne zusätzliche Journalbuchung | nur anhängen, Audit, TRUNCATE gesperrt; bestehende Originale und Herkunftshashes unverändert |

## Protokoll und Anmeldung

| Tabelle | Zweck | Schutz |
| --- | --- | --- |
| `audit_log` | Jede Änderung mit Zeitpunkt, Nutzer, Tabelle, altem und neuem Wert; als Hash-Kette mit Nummer (`seq`), Vorgänger-Hash und Hash | nur anhängen, auch kein `TRUNCATE` |
| `audit_chain` | Kopf der Hash-Kette: letzte Nummer und Hash, genau eine Zeile | nur vom Trigger auf `audit_log` fortgeschrieben |
| `seals` | Siegel festgeschriebener Buchungen, Rechnungen, Belege, Voranmeldungen und Lohnabrechnungen sowie jeder Zeile in Kassenbuch, Zuordnungen, Pauschalen, AfA und der Stornos von Belegen und Lohnabrechnungen: SHA-256 über Datensatz und abhängige Zeilen, mit den Spalten, über die er gebildet ist | nur anhängen, Audit |
| `user`, `session`, `account`, `verification`, `passkey` | Tabellen von Better Auth samt Passkey-Plugin; `user` trägt Rolle (`inhaber`, `steuerberatung`) und Sperre | `user`: genau ein lokaler Inhaber (`user_inhaber_single`), lokale Rolle nur durch den auditierten Offline-Rückweg änderbar, Audit; Passwörter und Sitzungen ohne Audit |
| `invitations` | Einladungen für die Steuerberatung: SHA-256 des Tokens, Rolle, Bezeichnung, Frist, eingelöst bzw. zurückgezogen | nur einmal einlösen oder zurückziehen, nie löschen; Audit |
| `user_logins` | Jede Anmeldung mit Konto, Rolle und Art (Passwort, Passkey, Einrichtung, SSO) | nur anhängen, Audit |
| `sso_issuers`, `sso_takeovers` | Einrichtung je Issuer und Betreiberzuordnung | nur anhängen, Audit |
| `sso_roles` | Zuletzt bestätigte externe Rolle je Konto und Issuer | Audit |
| `token_events`, `local_owner_recoveries` | Token-Verwaltung ohne Geheimnisse und Offline-Vorbereitung eines lokalen Inhabers | nur anhängen, Audit |
| `mcp_tokens` | API-Tokens für MCP und REST-API: Name, SHA-256 des Tokens, Anfang zum Wiedererkennen, Rechte, Ablauf, letzte Nutzung, Widerruf | ohne Audit (Zugangsdaten wie die Passkeys) |
| `mcp_calls` | Aufrufe über MCP und REST-API ohne Inhalte: Token, Werkzeug, Erfolg, Dauer; nach 90 Tagen gelöscht | ohne Audit |
| `backup_status` | Läufe des Backup-Containers (tägliches Backup, wöchentlicher Test-Restore) mit Ergebnis, Snapshot und Größe; der Container schreibt, die App liest | ohne Audit und Siegel (Betriebsdaten) |
