import { XMLParser } from "fast-xml-parser";
import { isValidIdnr } from "./bankverbindung.ts";
import { escapeXml } from "./xml.ts";

/**
 * Belegabruf für die vorausgefüllte Steuererklärung (VaSt): Verfahren ElsterDatenabholung, Datenart
 * ElsterVaStDaten, Datenabholung Version 10. Ablauf wie bei erica (digitalservicebund, MIT):
 * 1. Anfrage listet die Belege eines Jahres zur IdNr (Lohnsteuerbescheinigung, Rentenbezüge, Beiträge …),
 * 2. Abholung holt sie, ein Nutzdatenblock je Beleg-ID, Inhalt verschlüsselt im Datenpaket,
 * 3. EricDekodiereDaten entschlüsselt jedes Datenpaket mit dem Zertifikat zu Beleg-XML.
 * Eine Bestätigung wie beim Postfach gibt es nicht; die Belege lassen sich beliebig oft abholen.
 */

export const VAST_DATENART_VERSION = "ElsterVaStDaten";
/** Testmerker der Datenabholung und Berechtigungsverwaltung laut ERiC-Dokumentation */
export const VAST_TESTMERKER = "370000001";

export const VAST_BELEGART_LABEL: Record<string, string> = {
  VaSt_LStB: "Lohnsteuerbescheinigung",
  VaSt_RBM: "Rentenbezugsmitteilung",
  VaSt_KRV: "Kranken- und Pflegeversicherung",
  VaSt_AVOR: "Altersvorsorgebeiträge (Riester)",
  VaSt_LEL: "Lohnersatzleistungen",
  VaSt_VL: "Vermögenswirksame Leistungen",
  VaSt_Pers1: "Persönliche Daten",
  VaSt_Pers2: "Persönliche Daten (Religion, Familienstand)",
};

export const vastBelegartLabel = (belegart: string) => VAST_BELEGART_LABEL[belegart] ?? belegart.replace(/^VaSt_/, "");

export interface VastXmlInput {
  /** Steuer-IdNr der Person, deren Belege abgeholt werden */
  idnr: string;
  veranlagungsjahr: number;
  datenlieferant: string;
  herstellerId: string;
  test: boolean;
}

/** Ein Beleg in der Liste: noch ohne Inhalt */
export interface VastBelegRef {
  id: string;
  belegart: string;
  groesse: number;
  hashwert: string;
  schemaversion: string;
}

/** Abgeholter, noch verschlüsselter Beleg */
export interface VastDatenpaket {
  id: string;
  datenpaket: string;
}

function checkInput(input: VastXmlInput) {
  // Test-IdNrs von ELSTER beginnen mit 0 und tragen keine gültige Prüfziffer
  const ok = input.test ? /^\d{11}$/.test(input.idnr) : isValidIdnr(input.idnr);
  if (!ok) throw new Error(`Ungültige Steuer-IdNr: ${input.idnr}`);
  if (!Number.isInteger(input.veranlagungsjahr) || input.veranlagungsjahr < 2000) throw new RangeError(`Ungültiges Jahr: ${input.veranlagungsjahr}`);
}

function vastXml(nutzdaten: { ticket: string; body: string }[], input: VastXmlInput): string {
  const e = escapeXml;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    `<Verfahren>ElsterDatenabholung</Verfahren>`,
    `<DatenArt>ElsterVaStDaten</DatenArt>`,
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
    ...nutzdaten.flatMap(({ ticket, body }) => [
      `<Nutzdatenblock>`,
      `<NutzdatenHeader version="11">`,
      `<NutzdatenTicket>${e(ticket)}</NutzdatenTicket>`,
      `<Empfaenger id="L">CS</Empfaenger>`,
      `</NutzdatenHeader>`,
      `<Nutzdaten>`,
      `<Datenabholung version="10">`,
      body,
      `</Datenabholung>`,
      `</Nutzdaten>`,
      `</Nutzdatenblock>`,
    ]),
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}

/** Schritt 1: welche Belege liegen für IdNr und Jahr vor? */
export function buildVastAnfrageXml(input: VastXmlInput): string {
  checkInput(input);
  return vastXml([{ ticket: "1", body: `<Anfrage idnr="${input.idnr}" veranlagungsjahr="${input.veranlagungsjahr}"/>` }], input);
}

/** Schritt 2: Sammelabholung, ein Nutzdatenblock je Beleg mit der Beleg-ID als Ticket */
export function buildVastAbholungXml(ids: readonly string[], input: VastXmlInput): string {
  checkInput(input);
  if (ids.length === 0) throw new Error("Keine Belege zum Abholen.");
  return vastXml(
    ids.map((id) => ({
      ticket: id,
      body: `<Abholung id="${escapeXml(id)}" idnr="${input.idnr}" veranlagungsjahr="${input.veranlagungsjahr}"/>`,
    })),
    input,
  );
}

type Node = Record<string, unknown>;

const listParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ["Nutzdatenblock", "Id", "Abholung"].includes(name),
});

const asNodes = (value: unknown): Node[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is Node => typeof v === "object" && v !== null);

function findDeep(node: unknown, name: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) findDeep(item, name, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === name) out.push(...asNodes(value).concat(typeof value === "string" ? [{ "#text": value }] : []));
      else if (!key.startsWith("@")) findDeep(value, name, out);
    }
  }
  return out;
}

const text = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && value !== null && "#text" in value) return String((value as Node)["#text"]).trim();
  return "";
};

/** Liest die Beleg-IDs aus der Antwort auf die Anfrage */
export function parseVastBelegListe(serverResponseXml: string): VastBelegRef[] {
  if (!serverResponseXml.trim()) return [];
  const doc = listParser.parse(serverResponseXml) as unknown;
  const ids = findDeep(findDeep(doc, "Anfrage"), "Id");
  return ids
    .map((node) => ({
      id: text(node),
      belegart: text(node["@belegart"]),
      groesse: Number.parseInt(text(node["@groesse"]), 10) || 0,
      hashwert: text(node["@hashwert"]),
      schemaversion: text(node["@schemaversion"]),
    }))
    .filter((ref) => ref.id !== "");
}

/** Liest die verschlüsselten Datenpakete aus der Antwort auf die Abholung */
export function parseVastDatenpakete(serverResponseXml: string): VastDatenpaket[] {
  if (!serverResponseXml.trim()) return [];
  const doc = listParser.parse(serverResponseXml) as unknown;
  return findDeep(doc, "Abholung")
    .map((node) => ({
      id: text(node["@id"]),
      // Base64 ohne Zeilenumbrüche; manche Beispiele tragen sie als Text \r\n
      datenpaket: text(node.Datenpaket).replace(/\\r\\n|\s/g, ""),
    }))
    .filter((p) => p.id !== "" && p.datenpaket !== "");
}

/** Ein Wert aus einem Beleg: Pfad der Elemente unterhalb der Wurzel und Text */
export interface VastWert {
  pfad: string[];
  wert: string;
}

export interface VastBelegInhalt {
  /** Wurzelelement, z. B. VaSt_RBM */
  belegart: string;
  /** Alle Blätter in Dokumentreihenfolge */
  werte: VastWert[];
}

const belegParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  preserveOrder: true,
  trimValues: true,
});

type Ordered = Record<string, unknown> & { "#text"?: string };

function leaves(nodes: Ordered[], pfad: string[], out: VastWert[]) {
  for (const node of nodes) {
    for (const [name, children] of Object.entries(node)) {
      if (name === ":@" || name.startsWith("?")) continue;
      if (name === "#text") {
        out.push({ pfad, wert: String(children) });
        continue;
      }
      leaves(children as Ordered[], [...pfad, name], out);
    }
  }
}

/**
 * Liest ein entschlüsseltes Beleg-XML generisch: alle Werte mit Pfad. Die Schemas der einzelnen
 * Belegarten stehen in der ELSTER-Jahresdokumentation; bis dahin zeigt Haben die Werte so, wie sie kommen.
 * Ein Wrapper <Belege> mit mehreren Belegen wird in einzelne Belege zerlegt.
 */
export function parseVastBeleg(xml: string): VastBelegInhalt[] {
  const doc = belegParser.parse(xml.replace(/^\s*<\?xml[^>]*\?>/, "")) as Ordered[];
  const roots = doc.flatMap((node) => Object.entries(node).filter(([name]) => name !== ":@" && !name.startsWith("?") && name !== "#text"));
  return roots.flatMap(([name, children]) => {
    if (name === "Belege") return (children as Ordered[]).flatMap((child) => beleg(child));
    return beleg({ [name]: children } as Ordered);
  });
}

function beleg(node: Ordered): VastBelegInhalt[] {
  return Object.entries(node)
    .filter(([name]) => name !== ":@" && name !== "#text")
    .map(([belegart, children]) => {
      const werte: VastWert[] = [];
      leaves(children as Ordered[], [], werte);
      return { belegart, werte };
    });
}
