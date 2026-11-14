import { beschreibungXml, csvKopfzeile, DTD_DATEI, mitKopfzeile, type SpaltenTyp } from "@firsttris/gobd-kern/beschreibung";
import type { ArchiveFile } from "./export.ts";

export { csvKopfzeile, DTD_DATEI, type SpaltenTyp };

/*
 * index.xml für das Jahresarchiv (#546): die Beschreibungsdatei nach dem Beschreibungsstandard der Finanzverwaltung
 * (GDPdU/GoBD, Version 1.6 von 2019, CaseWare Germany). Mit ihr liest eine Prüfsoftware die CSV-Dateien des Archivs ohne
 * Handarbeit ein (Datenträgerüberlassung, Z3, § 147 Abs. 6 AO). Je CSV eine Table mit Pfad, Zeichensatz, Trennern, der
 * übersprungenen Kopfzeile und den Spalten. Die Annahme durch eine Prüfsoftware ist ungeprüft.
 *
 * Die DTD (gdpdu-01-03-2019.dtd) darf nicht verändert werden und liegt dem Archiv nicht bei: Haben hat keine
 * Originalfassung; die Prüfsoftware oder die Prüfung stellt sie, siehe docs/auswertungen.md. Das XML schreibt
 * @firsttris/gobd-kern; hier steht, was nur Haben weiß: welche Spalten Beträge und Daten sind und welche Dateien Originale.
 */

const TEXT: SpaltenTyp = { art: "text" };
const BETRAG: SpaltenTyp = { art: "zahl", nachkommastellen: 2 };
const DATUM: SpaltenTyp = { art: "datum" };

/**
 * Spalten, die das Archiv immer als Betrag („1234,56“) oder als Datum („JJJJ-MM-TT“) schreibt, je Datei. Alles andere ist
 * Text (AlphaNumeric): Das ist immer gültig und behält führende Nullen von Nummern; Zeitstempel („…T…Z“) sind keine Daten
 * im Sinne des Standards. Neue Spalten sind Text, bis sie hier stehen; ein Test prüft die Werte jeder Spalte, die hier
 * steht, gegen das erzeugte Archiv.
 */
const TYPEN: { pfad: RegExp; zahlen: string[]; daten: string[] }[] = [
  { pfad: /^rechnungen\/rechnungen\.csv$/, zahlen: ["Netto", "USt", "Brutto"], daten: ["Datum", "Fällig", "Leistung von", "Leistung bis"] },
  {
    pfad: /^belege\/belege\.csv$/,
    zahlen: ["Netto 19 %", "Vorsteuer 19 %", "Netto 7 %", "Vorsteuer 7 %", "Netto 0 %", "Netto", "Vorsteuer", "Brutto"],
    daten: ["Datum", "Fällig"],
  },
  { pfad: /^buchungen\/journal\.csv$/, zahlen: ["Soll", "Haben", "Bemessungsgrundlage"], daten: ["Datum"] },
  { pfad: /^bank\/[^/]+\/umsaetze\.csv$/, zahlen: ["Betrag", "Zugeordnet", "Offen"], daten: ["Buchungsdatum", "Wertstellung"] },
  { pfad: /^bank\/zuordnungen\.csv$/, zahlen: ["Betrag"], daten: ["Buchungsdatum"] },
  // Kassenbuch (cashBookCsv): Einnahme und Ausgabe sind je Zeile eine von beiden, die andere bleibt leer; der Anfangsbestand hat nur den Bestand
  { pfad: /^kasse\/kassenbuch\.csv$/, zahlen: ["Einnahme", "Ausgabe", "Bestand"], daten: ["Datum"] },
];

/** Die Spalten je Datei mit bekanntem Betrags- oder Datumsformat; für den Test, der die Werte dagegen prüft */
export const TYPISIERTE_SPALTEN = TYPEN;

export function spaltenTyp(path: string, spalte: string): SpaltenTyp {
  for (const t of TYPEN) {
    if (!t.pfad.test(path)) continue;
    if (t.zahlen.includes(spalte)) return BETRAG;
    if (t.daten.includes(spalte)) return DATUM;
  }
  return TEXT;
}

export interface Tabelle {
  path: string;
  spalten: string[];
}

export interface IndexInfo {
  /** Firma und Ort des Datenlieferanten */
  name: string;
  ort: string;
  jahr: number;
  version: string;
}

/** Die index.xml: je CSV eine Table, nach Pfad sortiert, damit gleiche Daten gleiche Datei ergeben */
export function indexXml(info: IndexInfo & { tabellen: Tabelle[] }): string {
  return beschreibungXml({
    lieferant: {
      name: info.name,
      ort: info.ort,
      kommentar: `Jahresarchiv ${info.jahr} aus Haben ${info.version}, Beschreibung nach dem Beschreibungsstandard der Finanzverwaltung (GDPdU, Version 1.6). Die Annahme durch eine Prüfsoftware ist ungeprüft.`,
    },
    medium: `Jahresarchiv ${info.jahr}`,
    tabellen: info.tabellen.map((t) => ({
      path: t.path,
      name: t.path.replace(/\.csv$/, ""),
      beschreibung: `Jahresarchiv ${info.jahr}: ${t.path}`,
      spalten: t.spalten.map((name) => ({ name, typ: spaltenTyp(t.path, name) })),
    })),
  });
}

/**
 * Dateien im Archiv, die Haben nicht selbst als CSV erzeugt, auch wenn ihr Name auf .csv endet: unveränderte Originale (der
 * DATEV-Stapel und andere Exporte des Altbestands, Auftragsdokumente aus sevDesk, Belege, die jemand hochgeladen hat). Sie
 * haben ein fremdes Format, die index.xml beschreibt sie nicht. Anhänge unter anhaenge/ sind immer PDF; die anhaenge.csv
 * dort schreibt Haben selbst.
 */
const ORIGINALE = [/^lexoffice\/(originale|belege)\//, /^sevdesk\/auftraege\//, /^belege\/(?!belege\.csv$|verrechnungen\.csv$)/];

const istEigeneCsv = (path: string) => path.endsWith(".csv") && !ORIGINALE.some((muster) => muster.test(path));

/** Reicht die Dateien des Archivs unverändert durch und hängt die index.xml aller CSVs hinten an (vor den Prüfsummen) */
export async function* mitIndexXml(files: AsyncIterable<ArchiveFile>, info: IndexInfo): AsyncGenerator<ArchiveFile> {
  const tabellen: Tabelle[] = [];
  for await (const file of files) {
    if (!istEigeneCsv(file.path)) {
      yield file;
    } else if (file.content instanceof Uint8Array) {
      tabellen.push({ path: file.path, spalten: csvKopfzeile(file.content) });
      yield file;
    } else {
      // Als Strom (etwa das Änderungsprotokoll): Die Kopfzeile steht fest, sobald das ZIP den Strom bis hinter den ersten
      // Zeilenumbruch gelesen hat, also lange vor dem Ende der Datei und vor der index.xml
      const tabelle: Tabelle = { path: file.path, spalten: [] };
      tabellen.push(tabelle);
      yield { ...file, content: mitKopfzeile(file.content, (spalten) => (tabelle.spalten = spalten)) };
    }
  }
  yield { path: "index.xml", content: new TextEncoder().encode(indexXml({ ...info, tabellen })), compress: true };
}
