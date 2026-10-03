import { XMLParser } from "fast-xml-parser";
import { isValidIdnr } from "./bankverbindung.ts";
import { VAST_TESTMERKER } from "./vast.ts";
import { escapeXml } from "./xml.ts";

/**
 * Berechtigungsmanagement für den Belegabruf (Verfahren ElsterBRM): das Recht beantragen, die Belege
 * einer anderen Person abzurufen (etwa des Ehegatten), mit dem Freischaltcode aus dem Brief an diese
 * Person freischalten, auflisten und widerrufen. Ablauf und Versionen wie bei erica (digitalservicebund, MIT).
 * Die Datenart ist zugleich die Datenart-Version für ERiC; ein Transferhandle gibt es hier nicht.
 */

export type SpezRechtDatenart = "SpezRechtAntrag" | "SpezRechtFreischaltung" | "SpezRechtStorno" | "SpezRechtListe";

/** Status eines Antrags laut ELSTER, z. B. offen, genehmigt, widerrufen, abgelaufen */
export type SpezRechtStatus = string;

export interface BrmXmlInput {
  datenlieferant: string;
  herstellerId: string;
  test: boolean;
}

export interface SpezRechtAntragInput extends BrmXmlInput {
  /** Steuer-IdNr der Person, deren Belege abgerufen werden sollen */
  dateninhaberIdnr: string;
  /** JJJJ-MM-TT */
  dateninhaberGeburtsdatum: string;
  /** JJJJ-MM-TT; bis dahin gilt die Berechtigung */
  gueltigBis: string;
  /** E-Mail-Adresse des Abrufenden für Benachrichtigungen von ELSTER */
  mail?: string;
  /** Leer: alle Jahre */
  jahre?: number[];
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function brmXml(datenart: SpezRechtDatenart, body: string[], input: BrmXmlInput): string {
  const e = escapeXml;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    `<Verfahren>ElsterBRM</Verfahren>`,
    `<DatenArt>${datenart}</DatenArt>`,
    `<Vorgang>send-Auth</Vorgang>`,
    ...(input.test ? [`<Testmerker>${VAST_TESTMERKER}</Testmerker>`] : []),
    `<HerstellerID>${e(input.herstellerId)}</HerstellerID>`,
    `<DatenLieferant>${e(input.datenlieferant)}</DatenLieferant>`,
    `<Datei>`,
    `<Verschluesselung>CMSEncryptedData</Verschluesselung>`,
    `<Kompression>GZIP</Kompression>`,
    `<TransportSchluessel></TransportSchluessel>`,
    `</Datei>`,
    `</TransferHeader>`,
    `<DatenTeil>`,
    `<Nutzdatenblock>`,
    `<NutzdatenHeader version="11">`,
    `<NutzdatenTicket>1</NutzdatenTicket>`,
    `<Empfaenger id="L">CS</Empfaenger>`,
    `</NutzdatenHeader>`,
    `<Nutzdaten>`,
    ...body,
    `</Nutzdaten>`,
    `</Nutzdatenblock>`,
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}

/** Antrag auf das Recht, die Belege (AbrufEBelege) einer anderen Person abzurufen */
export function buildSpezRechtAntragXml(input: SpezRechtAntragInput): string {
  const idnrOk = input.test ? /^\d{11}$/.test(input.dateninhaberIdnr) : isValidIdnr(input.dateninhaberIdnr);
  if (!idnrOk) throw new Error(`Ungültige Steuer-IdNr: ${input.dateninhaberIdnr}`);
  if (!isoDate.test(input.dateninhaberGeburtsdatum)) throw new Error("Geburtsdatum im Format JJJJ-MM-TT fehlt.");
  if (!isoDate.test(input.gueltigBis)) throw new Error("Gültig-bis-Datum im Format JJJJ-MM-TT fehlt.");
  const jahre = [...new Set(input.jahre ?? [])].sort();
  return brmXml(
    "SpezRechtAntrag",
    [
      `<SpezRechtAntrag version="3">`,
      `<DateninhaberIdNr>${input.dateninhaberIdnr}</DateninhaberIdNr>`,
      `<DateninhaberGeburtstag>${input.dateninhaberGeburtsdatum}</DateninhaberGeburtstag>`,
      `<Recht>AbrufEBelege</Recht>`,
      `<GueltigBis>${input.gueltigBis}</GueltigBis>`,
      ...(input.mail?.trim() ? [`<DatenabruferMail>${escapeXml(input.mail.trim())}</DatenabruferMail>`] : []),
      `<Veranlagungszeitraum>`,
      ...(jahre.length === 0
        ? [`<Unbeschraenkt>true</Unbeschraenkt>`]
        : [`<Unbeschraenkt>false</Unbeschraenkt>`, `<Veranlagungsjahre>`, ...jahre.map((j) => `<Jahr>${j}</Jahr>`), `</Veranlagungsjahre>`]),
      `</Veranlagungszeitraum>`,
      `</SpezRechtAntrag>`,
    ],
    input,
  );
}

/** Freischaltcode wie im Brief, mit oder ohne Bindestriche: ABCD-EFGH-IJKL */
export function normalizeFreischaltcode(code: string): string {
  const plain = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (plain.length !== 12) throw new Error("Der Freischaltcode hat 12 Zeichen (z. B. ABCD-EFGH-1234).");
  return `${plain.slice(0, 4)}-${plain.slice(4, 8)}-${plain.slice(8)}`;
}

const antragsIdOk = (id: string) => /^[A-Za-z0-9]{8,64}$/.test(id);

export function buildSpezRechtFreischaltungXml(antragsId: string, freischaltcode: string, input: BrmXmlInput): string {
  if (!antragsIdOk(antragsId)) throw new Error("Ungültige Antrags-ID.");
  return brmXml(
    "SpezRechtFreischaltung",
    [
      `<SpezRechtFreischaltung version="1">`,
      `<AntragsID>${antragsId}</AntragsID>`,
      `<Freischaltcode>${normalizeFreischaltcode(freischaltcode)}</Freischaltcode>`,
      `</SpezRechtFreischaltung>`,
    ],
    input,
  );
}

export function buildSpezRechtStornoXml(antragsId: string, input: BrmXmlInput): string {
  if (!antragsIdOk(antragsId)) throw new Error("Ungültige Antrags-ID.");
  return brmXml("SpezRechtStorno", [`<SpezRechtStorno version="3">`, `<AntragsID>${antragsId}</AntragsID>`, `</SpezRechtStorno>`], input);
}

/** Alle eigenen Anträge und Berechtigungen als Abrufender */
export function buildSpezRechtListeXml(input: BrmXmlInput): string {
  return brmXml("SpezRechtListe", [`<SpezRechtListe version="7"/>`], input);
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ["Antrag", "Jahr"].includes(name),
});

const text = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

function find(node: unknown, name: string): Node | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = find(item, name);
      if (hit) return hit;
    }
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === name && typeof value === "object" && value !== null) return value as Node;
      const hit = find(value, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

const parse = (xml: string): unknown => (xml.trim() ? parser.parse(xml) : {});

/** Rückgabe des Nutzdatenblocks; ELSTER meldet dort fachliche Fehler wie „kein Antrag vorhanden“ */
export function parseBrmRueckgabe(serverResponseXml: string): { code: number; text: string } | undefined {
  const header = find(parse(serverResponseXml), "NutzdatenHeader");
  const rueckgabe = header ? find(header, "Rueckgabe") : undefined;
  if (!rueckgabe) return undefined;
  return { code: Number.parseInt(text(rueckgabe.Code), 10) || 0, text: text(rueckgabe.Text).replace(/\s+/g, " ") };
}

export interface SpezRechtAntragAntwort {
  antragsId: string;
  antragsDatum: string;
  /** Bis dahin muss der Freischaltcode eingegeben werden */
  genehmigenBis: string;
  status: SpezRechtStatus;
}

export function parseSpezRechtAntragAntwort(serverResponseXml: string): SpezRechtAntragAntwort | undefined {
  const antwort = find(parse(serverResponseXml), "AntragAntwort");
  if (!antwort || !text(antwort.AntragsID)) return undefined;
  return {
    antragsId: text(antwort.AntragsID),
    antragsDatum: text(antwort.AntragsDatum),
    genehmigenBis: text(antwort.GenehmigenBis),
    status: text(antwort.AntragsStatus),
  };
}

/** Status nach Freischaltung (genehmigt) oder Widerruf (widerrufen) */
export function parseSpezRechtStatus(serverResponseXml: string): SpezRechtStatus | undefined {
  const doc = parse(serverResponseXml);
  const antwort = find(doc, "FreischaltenAntwort") ?? find(doc, "StornoAntwort");
  return antwort ? text(antwort.AntragsStatus) || undefined : undefined;
}

export interface SpezRecht {
  antragsId: string;
  antragsDatum: string;
  gueltigBis: string;
  status: SpezRechtStatus;
  recht: string;
  dateninhaberIdnr: string;
  /** leer: alle Jahre */
  jahre: number[];
}

export function parseSpezRechtListe(serverResponseXml: string): SpezRecht[] {
  const liste = find(parse(serverResponseXml), "SpezRechtListe");
  const antraege = (liste?.Antrag ?? []) as Node[];
  return antraege
    .map((a) => {
      const zeitraum = (a.Veranlagungszeitraum ?? {}) as Node;
      const jahre = ((zeitraum.Veranlagungsjahre as Node | undefined)?.Jahr ?? []) as unknown[];
      return {
        antragsId: text(a.AntragsID),
        antragsDatum: text(a.AntragsDatum),
        gueltigBis: text(a.GueltigBis),
        status: text(a.AntragsStatus),
        recht: text(a.Recht),
        dateninhaberIdnr: text(a.DateninhaberIdNr),
        jahre: text(zeitraum.Unbeschraenkt) === "true" ? [] : jahre.map((j) => Number(text(j))).filter(Number.isFinite),
      };
    })
    .filter((a) => a.antragsId !== "");
}
