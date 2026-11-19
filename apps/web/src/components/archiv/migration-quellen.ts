import {
  cancelLexofficeImport,
  cancelSevdeskImport,
  removeLexofficeKey,
  removeSevdeskToken,
  saveLexofficeKey,
  saveSevdeskToken,
  type getMigration,
} from "../../server/functions/archive.ts";
import { cancelFastbillImport, removeFastbillLogin, saveFastbillLogin } from "../../server/functions/fastbill.ts";

/* Quellen für den Umzug (Migration.tsx): was sich je Anbieter unterscheidet */

export type MigrationData = Awaited<ReturnType<typeof getMigration>>;
export type ImportRow = NonNullable<MigrationData["lastImport"]>;
/** Quellen mit API-Verbindung: Schlüssel speichern, entfernen, Abruf starten */
export type ConnectedSource = "lexoffice" | "sevdesk" | "fastbill";
export type FastbillPlan = MigrationData["fastbillPlans"][number];
/** Alle Quellen; Accountable, BuchhaltungsButler und WISO kennen keine API, dort gibt es nur den Datei-Upload */
export type Source = ConnectedSource | "accountable" | "buchhaltungsbutler" | "wiso";

/** Was sich je Quelle unterscheidet: Name, Schlüssel und die Server-Funktionen für Verbindung und Abruf */
export const SOURCES = {
  lexoffice: {
    product: "Lexware Office",
    keyLabel: "API-Schlüssel",
    keyHelp:
      "Die Public API gibt es im Tarif XL. Den Schlüssel erzeugst du in Lexware Office unter Erweiterungen → Public API (app.lexware.de/addons/public-api). Haben liest nur, es ändert nichts in Lexware Office.",
    removeLabel: "Schlüssel entfernen",
    importHelp:
      "Holt alle Kontakte, Ausgangsrechnungen, Gutschriften und Belege mit ihren Original-PDFs. Die API erlaubt etwa zwei Anfragen pro Sekunde; bei einigen hundert Belegen dauert das eine Weile, du kannst die Seite währenddessen verlassen. Ein neuer Abruf überspringt alles, was schon da ist.",
    exportsHelp:
      "Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) und den IDEA-Export aus Lexware Office hoch, dazu die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF.",
    save: saveLexofficeKey,
    remove: removeLexofficeKey,
    cancel: cancelLexofficeImport,
  },
  sevdesk: {
    product: "sevDesk",
    keyLabel: "API-Token",
    keyHelp: "Den API-Token findest du in sevDesk unter Einstellungen → Benutzer, beim jeweiligen Benutzer. Haben liest nur, es ändert nichts in sevDesk.",
    removeLabel: "Token entfernen",
    importHelp:
      "Holt alle Kontakte, Rechnungen, Gutschriften und Belege mit ihren PDFs bzw. Belegdateien. Angebote, Auftragsbestätigungen und Lieferscheine werden zusätzlich als Archivkopien übernommen. Auftrags-PDFs werden nur bei frisch bestätigter Buchhaltungsversion 1.0 oder 2.0 automatisch abgerufen; bei unbekannter Version können sie manuell ergänzt werden. Du kannst die Seite währenddessen verlassen.",
    exportsHelp:
      "Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) aus sevDesk hoch, dazu den Datenexport für die Betriebsprüfung (GoBD, als „IDEA-Export“ ablegen), die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF.",
    save: saveSevdeskToken,
    remove: removeSevdeskToken,
    cancel: cancelSevdeskImport,
  },
  fastbill: {
    product: "FastBill",
    keyLabel: "API-Schlüssel",
    keyHelp:
      "Den API-Schlüssel findest du in FastBill in den Einstellungen deines Kontos. Dazu die E-Mail, mit der du dich bei FastBill anmeldest, und dein Tarif: Er bestimmt, wie viele Anfragen FastBill je Stunde erlaubt. Haben liest nur, es ändert nichts in FastBill.",
    removeLabel: "Zugang entfernen",
    importHelp:
      "Holt alle Kunden, Ausgangsrechnungen, Gutschriften, Stornos und Ausgaben mit ihren PDFs. FastBill erlaubt je nach Tarif nur 50 bis 1000 Anfragen pro Stunde; an der Grenze wartet der Abruf und macht danach weiter, bei vielen Belegen dauert das Stunden. Du kannst die Seite währenddessen verlassen. Ein neuer Abruf überspringt alles, was schon da ist.",
    exportsHelp:
      "Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) aus FastBill hoch, dazu die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF.",
    save: saveFastbillLogin,
    remove: removeFastbillLogin,
    cancel: cancelFastbillImport,
  },
  accountable: {
    product: "Accountable",
    keyLabel: "API-Zugang",
    keyHelp: "Accountable bietet keinen API-Zugang an. Kennst du eine Schnittstelle, melde sie bitte als Fehler im Projekt.",
    removeLabel: "Zugang entfernen",
    importHelp:
      "Accountable bietet keinen API-Zugang, deshalb liest Haben den Export. Lade je Geschäftsjahr den DATEV-Export hoch: in Accountable unter Datenexport „DATEV“ wählen, Kontenrahmen wie hier eingestellt (meist SKR03), „Originaldokumente beifügen“ einschalten, ganzes Geschäftsjahr. Er enthält den DATEV-Buchungsstapel, die Belege und die Verknüpfung von Buchung zu Belegdatei. Den IDEA-Export und die Steuererklärungen liefert Accountable nicht mit; lade sie in Schritt 4 getrennt hoch.",
    exportsHelp:
      "Die Exportdatei von Accountable bringt Buchungen und Belege schon mit. Zusätzlich brauchst du den IDEA-Export (Betriebsprüfung, GoBD) und je Geschäftsjahr die Steuererklärungen (Einkommensteuer- bzw. Körperschaftsteuer- und Gewerbesteuerbescheid, Umsatzsteuer-Jahresbescheid) sowie die übermittelten Voranmeldungen und die Kontoauszüge der Bank als PDF.",
    save: null,
    remove: null,
    cancel: null,
  },
} as const;

export const BB_CONFIG = {
  product: "BuchhaltungsButler",
  importHelp: "Liest Buchungen, Belege und PDFs aus den Exportdateien von BuchhaltungsButler ein.",
  exportsHelp:
    "Der BB-Import legt die Originalexporte bereits an. Ergänze je Geschäftsjahr noch den Datenexport für die Betriebsprüfung, ELSTER-Protokolle und Kontoauszüge.",
} as const;
export const WISO_CONFIG = {
  product: "WISO",
  importHelp: "Liest den CSV-Export der Buchungen aus WISO Steuer (Modul EÜR) oder WISO EÜR & Kasse ins Archiv ein.",
  exportsHelp: "Der WISO-Import legt die Original-CSV bereits ab. Ergänze je Geschäftsjahr noch GoBD-Export, ELSTER-Protokolle und Kontoauszüge.",
} as const;
export const ALL_SOURCES = { ...SOURCES, buchhaltungsbutler: BB_CONFIG, wiso: WISO_CONFIG } as const;
