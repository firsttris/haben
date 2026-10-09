import { XMLParser } from "fast-xml-parser";
import { ElsterEingabeError, elsterXml, escapeXml, TESTMERKER } from "./xml.ts";
import { findDeep, int, text } from "./xml-lesen.ts";

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
  return elsterXml(
    { verfahren: "ElsterDatenabholung", datenArt, testmerker: input.test ? TESTMERKER : undefined, herstellerId: input.herstellerId, datenlieferant: input.datenlieferant },
    [
      {
        ticket: "1",
        empfaenger: { id: "L", wert: "CS" },
        produktVersion: input.produktVersion,
        nutzdaten: [`<Datenabholung xmlns="http://finkonsens.de/elster/elsterdatenabholung/v3" version="31">`, ...body, `</Datenabholung>`],
      },
    ],
  );
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
  if (ids.length === 0) throw new ElsterEingabeError("Keine Bereitstellungen zum Bestätigen.");
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ["DatenartBereitstellung", "Bereitstellung", "Meta", "Anhang"].includes(name),
});

/** Liest die Bereitstellungen aus der Serverantwort auf eine PostfachAnfrage */
export function parsePostfachAntwort(serverResponseXml: string): PostfachBereitstellung[] {
  if (!serverResponseXml.trim()) return [];
  const doc = parser.parse(serverResponseXml) as unknown;
  const result: PostfachBereitstellung[] = [];
  for (const dab of findDeep(doc, "DatenartBereitstellung")) {
    const datenart = text(dab["@name"]);
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
