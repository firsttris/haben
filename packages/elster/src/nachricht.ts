import { finanzamtsnummer } from "@haben/core";
import { escapeXml, PRODUKT_NAME, TESTMERKER } from "./xml.ts";

/**
 * Sonstige Nachricht an das Finanzamt (Verfahren ElsterNachricht, Datenart SonstigeNachrichten,
 * Version 21). Aufbau wie bei viking, das damit an ELSTER sendet.
 */
export const NACHRICHT_BETREFF_MAX = 99;
export const NACHRICHT_TEXT_MAX = 15_000;

export interface NachrichtXmlInput {
  steuernummer13: string;
  /** Kürzel des Bundeslands, z. B. "BW" */
  bundesland: string;
  absender: { name: string; strasse: string; plz: string; ort: string };
  betreff: string;
  text: string;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

/** "Hauptstraße 12a" → Straße und Hausnummer; ELSTER will beides getrennt */
export function splitStrasse(strasse: string): { strasse: string; hausnummer: string } | null {
  const match = /^(.*?)\s*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(strasse.trim());
  if (!match?.[1] || !match[2]) return null;
  return { strasse: match[1].replace(/,$/, "").trim(), hausnummer: match[2].replace(/\s+/g, "") };
}

export function buildNachrichtXml(input: NachrichtXmlInput): string {
  if (!/^\d{13}$/.test(input.steuernummer13)) throw new Error(`Steuernummer muss 13-stellig im ELSTER-Format sein: ${input.steuernummer13}`);
  const betreff = input.betreff.trim();
  const text = input.text.trim();
  if (!betreff || betreff.length > NACHRICHT_BETREFF_MAX) throw new Error(`Der Betreff braucht 1 bis ${NACHRICHT_BETREFF_MAX} Zeichen.`);
  if (!text || text.length > NACHRICHT_TEXT_MAX) throw new Error(`Der Text braucht 1 bis ${NACHRICHT_TEXT_MAX} Zeichen.`);
  const adresse = splitStrasse(input.absender.strasse);
  if (!adresse) throw new Error("In der Anschrift fehlt die Hausnummer.");
  const a = input.absender;
  const e = escapeXml;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    `<Verfahren>ElsterNachricht</Verfahren>`,
    `<DatenArt>SonstigeNachrichten</DatenArt>`,
    `<Vorgang>send-Auth</Vorgang>`,
    ...(input.test ? [`<Testmerker>${TESTMERKER}</Testmerker>`] : []),
    `<Empfaenger id="L"><Ziel>${e(input.bundesland)}</Ziel></Empfaenger>`,
    `<HerstellerID>${e(input.herstellerId)}</HerstellerID>`,
    `<DatenLieferant>${e(a.name)}</DatenLieferant>`,
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
    `<Empfaenger id="F">${e(finanzamtsnummer(input.steuernummer13))}</Empfaenger>`,
    `<Hersteller>`,
    `<ProduktName>${PRODUKT_NAME}</ProduktName>`,
    `<ProduktVersion>${e(input.produktVersion)}</ProduktVersion>`,
    `</Hersteller>`,
    `</NutzdatenHeader>`,
    `<Nutzdaten>`,
    `<Nachricht xmlns="http://finkonsens.de/elster/elsternachricht/sonstigenachrichten/v21" version="21">`,
    `<Steuernummer>${input.steuernummer13}</Steuernummer>`,
    `<Steuerpflichtiger>`,
    `<SteuerpflichtigerTyp>NichtNatPerson</SteuerpflichtigerTyp>`,
    `<Name>${e(a.name)}</Name>`,
    `<Adresse>`,
    `<StrAdrInl>`,
    `<Strasse>${e(adresse.strasse)}</Strasse>`,
    `<Hausnummer>${e(adresse.hausnummer)}</Hausnummer>`,
    `<Postleitzahl>${e(a.plz)}</Postleitzahl>`,
    `<Ort>${e(a.ort)}</Ort>`,
    `</StrAdrInl>`,
    `</Adresse>`,
    `</Steuerpflichtiger>`,
    `<Inhalt>`,
    `<Betreff>${e(betreff)}</Betreff>`,
    `<Text>${e(text)}</Text>`,
    `</Inhalt>`,
    `</Nachricht>`,
    `</Nutzdaten>`,
    `</Nutzdatenblock>`,
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}
