import { finanzamtsnummer } from "@haben/core";
import { checkSteuernummer13, ElsterEingabeError, elsterXml, escapeXml, TESTMERKER } from "./xml.ts";

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

/**
 * "Hauptstraße 12a" → Straße, Hausnummer (nur Ziffern, so verlangen es die ELSTER-Schemas) und Zusatz ("a", "-14").
 */
export function splitStrasse(strasse: string): { strasse: string; hausnummer: string; zusatz?: string } | null {
  const match = /^(.*?)\s*(\d+)(\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(strasse.trim());
  if (!match?.[1] || !match[2]) return null;
  const zusatz = match[3]!.replace(/\s+/g, "").replace(/^-(?=[a-zA-Z])/, "");
  return { strasse: match[1].replace(/,$/, "").trim(), hausnummer: match[2], ...(zusatz ? { zusatz } : {}) };
}

export function buildNachrichtXml(input: NachrichtXmlInput): string {
  checkSteuernummer13(input.steuernummer13);
  const betreff = input.betreff.trim();
  const text = input.text.trim();
  if (!betreff || betreff.length > NACHRICHT_BETREFF_MAX) throw new ElsterEingabeError(`Der Betreff braucht 1 bis ${NACHRICHT_BETREFF_MAX} Zeichen.`);
  if (!text || text.length > NACHRICHT_TEXT_MAX) throw new ElsterEingabeError(`Der Text braucht 1 bis ${NACHRICHT_TEXT_MAX} Zeichen.`);
  const adresse = splitStrasse(input.absender.strasse);
  if (!adresse) throw new ElsterEingabeError("In der Anschrift fehlt die Hausnummer.");
  const a = input.absender;
  const e = escapeXml;
  return elsterXml(
    {
      verfahren: "ElsterNachricht",
      datenArt: "SonstigeNachrichten",
      testmerker: input.test ? TESTMERKER : undefined,
      ziel: input.bundesland,
      herstellerId: input.herstellerId,
      datenlieferant: a.name,
    },
    [
      {
        ticket: "1",
        empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) },
        produktVersion: input.produktVersion,
        nutzdaten: [
          `<Nachricht xmlns="http://finkonsens.de/elster/elsternachricht/sonstigenachrichten/v21" version="21">`,
          `<Steuernummer>${input.steuernummer13}</Steuernummer>`,
          `<Steuerpflichtiger>`,
          `<SteuerpflichtigerTyp>NichtNatPerson</SteuerpflichtigerTyp>`,
          `<Name>${e(a.name)}</Name>`,
          `<Adresse>`,
          `<StrAdrInl>`,
          `<Strasse>${e(adresse.strasse)}</Strasse>`,
          `<Hausnummer>${e(adresse.hausnummer)}</Hausnummer>`,
          ...(adresse.zusatz ? [`<Hausnummernzusatz>${e(adresse.zusatz)}</Hausnummernzusatz>`] : []),
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
        ],
      },
    ],
  );
}
