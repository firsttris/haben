import { XMLParser } from "fast-xml-parser";
import { escapeXml, PRODUKT_NAME, TESTMERKER } from "./xml.ts";

/**
 * Datenabholung aus dem ELSTER-Postfach (Verfahren ElsterDatenabholung, Version 31): Bescheide und
 * Mitteilungen des Finanzamts. Ablauf wie bei viking:
 * 1. PostfachAnfrage listet die Bereitstellungen samt Anhängen,
 * 2. die Anhänge kommen über Otto (libotto.so) vom OTTER-Server,
 * 3. PostfachBestaetigung quittiert die Abholung. Ohne Quittung innerhalb von 24 Stunden
 *    droht die Sperre der Hersteller-ID.
 */

/** Was die Anfrage abholt: Bescheide (DIVA), Steuerbescheid-Daten (ESB) und Postfach-Mitteilungen */
export const POSTFACH_DATENARTEN = [
  "ESB",
  "EPMitteilung",
  "DivaBescheidESt",
  "DivaBescheidUSt",
  "DivaBescheidGewSt",
  "DivaBescheidKSt",
  "DivaBescheidFEIN",
  "DivaSonstigerVA",
] as const;

export const POSTFACH_DATENART_LABEL: Record<string, string> = {
  ESB: "Steuerbescheid (Daten)",
  EPMitteilung: "Mitteilung",
  DivaBescheidESt: "Einkommensteuerbescheid",
  DivaBescheidUSt: "Umsatzsteuerbescheid",
  DivaBescheidGewSt: "Gewerbesteuer-Messbescheid",
  DivaBescheidKSt: "Körperschaftsteuerbescheid",
  DivaBescheidFEIN: "Feststellungsbescheid",
  DivaSonstigerVA: "Sonstiger Verwaltungsakt",
};

export interface PostfachAnhang {
  dateibezeichnung: string;
  dateityp: string;
  /** Objekt-ID für Otto */
  referenzId: string;
  groesse: number;
}

export interface PostfachBereitstellung {
  id: string;
  datenart: string;
  groesse: number;
  veranlagungszeitraum: string;
  steuernummer: string;
  bescheiddatum: string;
  anhaenge: PostfachAnhang[];
}

export interface PostfachXmlInput {
  datenlieferant: string;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

function datenabholungXml(datenArt: "PostfachAnfrage" | "PostfachBestaetigung", body: string[], input: PostfachXmlInput): string {
  const e = escapeXml;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    `<Verfahren>ElsterDatenabholung</Verfahren>`,
    `<DatenArt>${datenArt}</DatenArt>`,
    `<Vorgang>send-Auth</Vorgang>`,
    ...(input.test ? [`<Testmerker>${TESTMERKER}</Testmerker>`] : []),
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
    `<Hersteller>`,
    `<ProduktName>${PRODUKT_NAME}</ProduktName>`,
    `<ProduktVersion>${e(input.produktVersion)}</ProduktVersion>`,
    `</Hersteller>`,
    `</NutzdatenHeader>`,
    `<Nutzdaten>`,
    `<Datenabholung xmlns="http://finkonsens.de/elster/elsterdatenabholung/v3" version="31">`,
    ...body,
    `</Datenabholung>`,
    `</Nutzdaten>`,
    `</Nutzdatenblock>`,
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}

export function buildPostfachAnfrageXml(input: PostfachXmlInput): string {
  return datenabholungXml(
    "PostfachAnfrage",
    [
      `<PostfachAnfrage einschraenkung="alle" max="1000">`,
      ...POSTFACH_DATENARTEN.map((name) => `<DatenartBereitstellung name="${name}"/>`),
      `</PostfachAnfrage>`,
    ],
    input,
  );
}

export function buildPostfachBestaetigungXml(ids: readonly string[], input: PostfachXmlInput): string {
  if (ids.length === 0) throw new Error("Keine Bereitstellungen zum Bestätigen.");
  return datenabholungXml(
    "PostfachBestaetigung",
    [
      `<PostfachBestaetigung>`,
      `<Bereitstellungen>`,
      ...ids.map((id) => `<Bereitstellung id="${escapeXml(id)}"/>`),
      `</Bereitstellungen>`,
      `</PostfachBestaetigung>`,
    ],
    input,
  );
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ["DatenartBereitstellung", "Bereitstellung", "Meta", "Anhang"].includes(name),
});

const asNodes = (value: unknown): Node[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is Node => typeof v === "object" && v !== null);

/** Alle Elemente mit diesem Namen, egal wie tief */
function findDeep(node: unknown, name: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) findDeep(item, name, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === name) out.push(...asNodes(value));
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

const int = (value: unknown) => {
  const n = Number.parseInt(text(value), 10);
  return Number.isFinite(n) ? n : 0;
};

/** Liest die Bereitstellungen aus der Serverantwort auf eine PostfachAnfrage */
export function parsePostfachAntwort(serverResponseXml: string): PostfachBereitstellung[] {
  if (!serverResponseXml.trim()) return [];
  const doc = parser.parse(serverResponseXml) as unknown;
  const result: PostfachBereitstellung[] = [];
  for (const dab of findDeep(doc, "DatenartBereitstellung")) {
    const datenart = text(dab["@name"]);
    if (int(dab["@anzahltreffer"]) === 0) continue;
    for (const bs of findDeep(dab, "Bereitstellung")) {
      const id = text(bs["@id"]);
      if (!id) continue;
      const meta = (name: string) => text(findDeep(bs, "Meta").find((m) => text(m["@name"]) === name));
      result.push({
        id,
        datenart,
        groesse: int(bs["@groesse"]),
        veranlagungszeitraum: meta("veranlagungszeitraum"),
        steuernummer: meta("steuernummer"),
        bescheiddatum: meta("bescheiddatum"),
        anhaenge: findDeep(bs, "Anhang")
          .map((a) => ({
            dateibezeichnung: text(a.Dateibezeichnung),
            dateityp: text(a.Dateityp),
            referenzId: text(a.DateiReferenzId),
            groesse: int(a.DateiGroesse),
          }))
          .filter((a) => a.referenzId !== ""),
      });
    }
  }
  return result;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/xml": ".xml",
  "application/xml": ".xml",
  "text/html": ".html",
};

/** Dateiname wie bei viking: Bezeichnung_Jahr.pdf */
export function postfachDateiname(b: Pick<PostfachBereitstellung, "veranlagungszeitraum">, a: Pick<PostfachAnhang, "dateibezeichnung" | "dateityp">): string {
  const base = (a.dateibezeichnung || "Dokument").replace(/[\s/\\:*?"<>|]/g, "_");
  const jahr = b.veranlagungszeitraum ? `_${b.veranlagungszeitraum}` : "";
  return `${base}${jahr}${EXTENSIONS[a.dateityp] ?? ".bin"}`;
}
