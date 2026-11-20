import pkg from "../../../../package.json" with { type: "json" };
import type { schema } from "../../db/index.ts";

// LIESMICH.txt des Jahresarchivs und die Haben-Version, die es nennt

export const HABEN_VERSION: string = pkg.version;

export function readme(year: number, now: Date, company: typeof schema.company.$inferSelect | undefined): string {
  const created = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Berlin" }).format(now);
  return `Haben – Jahresarchiv ${year}
${"=".repeat(21 + String(year).length)}

Firma:          ${company?.name || "–"}${company?.steuernummer ? `, Steuernummer ${company.steuernummer}` : ""}
Zeitraum:       01.01.${year} bis 31.12.${year}
Erstellt:       ${created} (${now.toISOString()})
Haben-Version:  ${HABEN_VERSION}

Dieses Archiv enthält alle Rechnungen, Belege, Buchungen, Bankumsätze und
Umsatzsteuer-Voranmeldungen des Jahres ${year}, wie sie in Haben gespeichert sind.
Zugeordnet wird nach Datum: Rechnungen nach Rechnungsdatum, Belege nach Belegdatum
(ohne Datum nach Tag des Hochladens), Buchungen nach Buchungsdatum, Bankumsätze nach
Buchungstag, Voranmeldungen nach Zeitraum, das Protokoll nach Zeitpunkt der Änderung.


INHALT

rechnungen/              Festgeschriebene Ausgangsrechnungen als PDF und E-Rechnungs-XML
                         (bei ZUGFeRD steckt das XML zusätzlich im PDF), dazu
                         rechnungen.csv mit Beträgen und SHA-256 aus der Festschreibung.
                         Entwürfe ohne Rechnungsnummer sind nicht enthalten. Nur wenn
                         vorhanden: zusätzliche Anhänge der Rechnungen unter anhaenge/,
                         Name: Nummer_Dateiname, mit anhaenge.csv.
rechnungen/verrechnungen.csv
                         Nur wenn vorhanden: Verrechnungen einer Ausgangsrechnung mit
                         einer Kundenkorrektur ohne Zahlung, je Verrechnung beide Seiten
                         mit Datum, Betrag und Grund; aufgehobene als Gegenzeile.
angebote/                Nur wenn vorhanden: festgeschriebene Angebote des Jahres als PDF,
                         angebote.csv mit Antwort des Kunden und daraus entstandener
                         Rechnung. Nur wenn vorhanden: zusätzliche Anhänge der Angebote
                         unter anhaenge/, Name: Nummer_Dateiname, mit anhaenge.csv.
belege/                  Eingangsrechnungen und Quittungen als Originaldatei,
                         Name: Datum_Lieferant_Kurz-ID; belege.csv mit Beträgen je
                         Steuersatz, Status, Storno (Datum und Grund), SHA-256 und
                         ursprünglichem Dateinamen.
belege/verrechnungen.csv Nur wenn vorhanden: Verrechnungen zweier Eingangsbelege ohne
                         Zahlung (etwa eine Gutschrift gegen eine Rechnung), je
                         Verrechnung beide Seiten mit Datum, Betrag und Grund;
                         aufgehobene als Gegenzeile.
buchungen/journal.csv    Journal, eine Zeile je Buchungszeile (Konto, Soll, Haben,
                         Steuerschlüssel, Bemessungsgrundlage bei Ist-Versteuerung an
                         der Zahlung); Stornos verweisen auf die Ursprungsbuchung.
anlagen/anlagenverzeichnis.csv
                         Anlagenverzeichnis des Jahres: Anschaffung, Buchwert am
                         Jahresanfang, Zugang, AfA, Abgang und Buchwert am Jahresende.
pauschalen/pauschalen.csv
                         Nur wenn vorhanden: Pauschalen ohne Beleg (Homeoffice-Tage,
                         Fahrten, Verpflegungsmehraufwand, Wege zur Betriebsstätte) mit
                         ihren Angaben als Eigenbeleg; Stornos als Gegenzeile.
kasse/kassenbuch.csv     Nur wenn vorhanden: Kassenbuch des Jahres mit fortlaufender
                         Nummer, Anfangsbestand und Bestand nach jeder Zeile; bei
                         Bareinnahmen auf Rechnungen die Rechnungsnummer.
bank/<IBAN>/umsaetze.csv Importierte Kontoumsätze je Konto (Zahlungsdienstleister unter ihrem Namen).
                         Bestätigte Dubletten behalten ihren Betrag und ihre Importdatei,
                         stehen als Dublette in der Liste und haben einen offenen Betrag von 0.
bank/zuordnungen.csv     Zuordnungen der Umsätze zu Rechnungen, Belegen und Buchungen
                         ohne Beleg; aufgehobene Zuordnungen als Gegenzeile.
bank/verrechnungen.csv   Nur wenn vorhanden: miteinander verrechnete gegenläufige Umsätze
                         (etwa Kartenprüfung und Rückbuchung) mit Notiz, ohne Buchung;
                         aufgehobene als Gegenzeile.
bank/ausbuchungen.csv    Nur wenn vorhanden: ausgebuchte Reste von Rechnungen und Belegen
                         (Skonto, Forderungsausfall); aufgehobene als Gegenzeile; bei
                         Skonto zu einer Bareinnahme die Nummer im Kassenbuch.
bank/importe.csv         Importierte Kontoauszugsdateien und Kontoabrufe mit SHA-256,
                         Zeitraum, Salden und Hinweisen; abgelehnte Abrufe ohne Zeitraum
                         nach dem Tag des Abrufs; ein Abruf, der einen Umsatz des Jahres
                         verbunden hat (etwa vom 30.12.), auch im Jahr dieses Umsatzes.
                         Die Auszugsdateien selbst speichert Haben nicht.
bank/quellen.csv         Nur wenn vorhanden: Herkunft der abgerufenen Umsätze: je
                         Ereignis (Bankabruf, Etsy, PayPal, REST-Import) die Quelle
                         mit Stichtag, der Abruf, der Umsatz, den Haben angelegt oder
                         verbunden hat,
                         und die gelieferten Referenzen (Anbieterreferenz,
                         Ereigniscode, EndToEndId, Bezug, Auszahlung, Bestellung).
bank/klaerungen.csv      Nur wenn vorhanden: geklärte Konflikte im Abruf: bisheriger und
                         gelieferter Umsatz, die Entscheidung und ein neu angelegter
                         Umsatz; der abgelehnte Abruf steht in bank/importe.csv.
umsatzsteuer/<JJJJ-MM>/  Voranmeldung mit den gespeicherten Kennzahlen (anmeldung.json),
                         jede Prüfung und Übermittlung (übermittlungen.csv) mit
                         ERiC-Protokoll (PDF) und gesendetem bzw. empfangenem XML;
                         bei einer Abgabe außerhalb von Haben der Vermerk mit dem
                         Übermittlungsprotokoll aus Mein ELSTER (PDF).
stammdaten/              Kontakte (aktueller Stand und alle Versionen), Bankkonten und
                         Firmendaten. Das ELSTER-Zertifikat ist absichtlich nicht enthalten.
                         Nur wenn vorhanden: Bestätigungen von USt-IdNrn. beim BZSt im
                         Jahr (ustid-bestaetigungen.csv) mit der Antwort als Nachweis.
lexoffice/               Nur bei übernommenem Altbestand: Rechnungen und Belege aus
                         Lexware Office, sevDesk, FastBill oder BuchhaltungsButler (Spalte
                         Quelle; in Lexoffice-ID steht bei sevDesk Art und ID, z. B. invoice/123,
                         bei FastBill mit Präfix, z. B. fastbill/invoice/123) mit
                         Originaldateien und Dateistand (belege.csv), Einzelzahlungen aus
                         sevDesk (zahlungen.csv), was an Dateien fehlte oder nachkam
                         (dateistand.csv), die Zeilen des
                         DATEV-Buchungsstapels (datev-buchungen.csv) und die unveränderten
                         Originalexporte des Jahres (originale/: DATEV, IDEA,
                         ELSTER-Protokolle, Kontoauszüge, Finanzberichte der
                         App-Stores).
protokoll/audit.csv      Änderungsprotokoll des Jahres mit altem und neuem Wert, in der
                         Reihenfolge der Hash-Kette mit Vorgänger-Hash und Hash je Eintrag.
protokoll/pruefwert.txt  Prüfwert (Kopf der Hash-Kette) beim Erstellen des Archivs und am
                         Ende des Jahres.
protokoll/versionen.csv  Eingesetzte Haben- und PostgreSQL-Versionen im Jahr mit Startzeitpunkt
                         (einschließlich fortgeführtem Vorjahresstand und Verweis auf Hinweise).
verfahrensdokumentation.md
                         Verfahrensdokumentation in der Fassung beim Erstellen des Archivs
                         (Markdown), mit Stand und Haben-Version.
index.xml                Beschreibung aller CSV-Dateien (Pfad, Zeichensatz, Trenner, Spalten,
                         Beträge und Daten) nach dem Beschreibungsstandard der Finanzverwaltung
                         (GDPdU), mit der eine Prüfsoftware die Dateien einliest. Die DTD
                         gdpdu-01-03-2019.dtd gehört dazu und liegt nicht bei (Bezug: CaseWare
                         Germany). Ob eine Prüfsoftware die Datei annimmt, ist nicht geprüft.
pruefsummen.sha256       SHA-256 jeder Datei in diesem Archiv.


ORIGINALE

PDF-, XML- und Bilddateien sind byte-genau die gespeicherten Originale, unverändert.
Die SHA-256-Werte in rechnungen.csv und belege.csv wurden beim Festschreiben bzw.
Hochladen berechnet und müssen zu den Dateien passen.


ÄNDERUNGSPROTOKOLL

Jeder Eintrag im Audit-Log ist mit seinem Vorgänger verkettet: Hash = SHA-256 aus
Vorgänger-Hash und Inhalt. Festgeschriebene Buchungen, Rechnungen, Belege,
Voranmeldungen und die Zeilen von Kassenbuch, Zuordnungen, Pauschalen und AfA
tragen ein Siegel über ihren Inhalt, das selbst im Protokoll steht.
Geprüft wird beides in Haben (Einstellungen → Export → Änderungsprotokoll prüfen).
Den Prüfwert aus protokoll/pruefwert.txt außerhalb des Servers aufbewahren: Er zeigt
später, ob das Protokoll bis zu diesem Eintrag nachträglich verändert wurde. Die Kette
verhindert keine Änderung, sie macht sie sichtbar. Geheimnisse (Zugangsdaten) sind
in audit.csv entfernt; den Hash eines Eintrags nachrechnen kann daher nur Haben.


PRÜFSUMMEN PRÜFEN

Nach dem Entpacken im Archivordner:
  Linux:    sha256sum -c pruefsummen.sha256
  macOS:    shasum -a 256 -c pruefsummen.sha256
  Windows:  Get-FileHash -Algorithm SHA256 <Datei>   (PowerShell, einzeln vergleichen)


CSV-DATEIEN

UTF-8 mit BOM, Trennzeichen Semikolon, Beträge in Euro mit Dezimalkomma (1234,56),
Datumsangaben als JJJJ-MM-TT, Zeitpunkte in UTC (ISO 8601). Felder mit Semikolon,
Anführungszeichen oder Zeilenumbruch stehen in Anführungszeichen.


AUFBEWAHRUNG

Nach § 147 AO und den GoBD sind Bücher, Aufzeichnungen und Buchungsbelege
aufzubewahren: Bücher und Aufzeichnungen 10 Jahre, Buchungsbelege seit 2025 8 Jahre,
Handels- und Geschäftsbriefe 6 Jahre. Die Frist beginnt mit dem Ende des
Kalenderjahrs, hier also am 31.12.${year}. Am einfachsten bewahrst du das ganze Archiv
10 Jahre auf, bis mindestens 31.12.${year + 10}, unverändert und lesbar, zum Beispiel
zusätzlich zum Backup auf einem zweiten Datenträger. Elektronisch empfangene Rechnungen
(E-Rechnungen) müssen elektronisch aufbewahrt werden; ein Ausdruck reicht nicht.
`;
}
