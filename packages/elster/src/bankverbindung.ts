import { finanzamtsnummer } from "@haben/core";
import { escapeXml, PRODUKT_NAME, TESTMERKER } from "./xml.ts";

/**
 * Änderung der Bankverbindung beim Finanzamt (Verfahren ElsterNachricht, Datenart AenderungBankverbindung,
 * Version 20). Aufbau wie bei viking. Das Finanzamt nutzt das Konto danach für Erstattungen und,
 * falls erteilt, für Lastschriften.
 */
export interface Steuerpflichtiger {
  /** Steuerliche Identifikationsnummer, 11 Ziffern */
  idnr: string;
  anrede: "Herrn" | "Frau";
  vorname: string;
  name: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
}

export interface BankverbindungXmlInput {
  steuernummer13: string;
  bundesland: string;
  person: Steuerpflichtiger;
  iban: string;
  /** Name im TransferHeader, sonst Vor- und Nachname */
  datenlieferant?: string;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

/** Prüfziffer der steuerlichen Identifikationsnummer (ISO 7064, MOD 11,10) */
export function isValidIdnr(idnr: string): boolean {
  if (!/^[1-9]\d{10}$/.test(idnr)) return false;
  let product = 10;
  for (const digit of idnr.slice(0, 10)) {
    let sum = (Number(digit) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  const check = (11 - product) % 10;
  return check === Number(idnr[10]);
}

/** IBAN-Prüfsumme (ISO 13616, MOD 97) */
export function isValidIban(iban: string): boolean {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (const char of rearranged) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** 1980-03-15 → 15.03.1980 */
export function germanDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Datum im Format JJJJ-MM-TT erwartet: ${isoDate}`);
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function buildBankverbindungXml(input: BankverbindungXmlInput): string {
  if (!/^\d{13}$/.test(input.steuernummer13)) throw new Error(`Steuernummer muss 13-stellig im ELSTER-Format sein: ${input.steuernummer13}`);
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  if (!isValidIban(iban)) throw new Error("Die IBAN ist ungültig.");
  const p = input.person;
  if (!isValidIdnr(p.idnr)) throw new Error("Die steuerliche Identifikationsnummer ist ungültig.");
  if (!p.vorname.trim() || !p.name.trim()) throw new Error("Vor- und Nachname fehlen.");
  const e = escapeXml;
  const datenlieferant = input.datenlieferant?.trim() || `${p.vorname} ${p.name}`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Elster xmlns="http://www.elster.de/elsterxml/schema/v11">`,
    `<TransferHeader version="11">`,
    `<Verfahren>ElsterNachricht</Verfahren>`,
    `<DatenArt>AenderungBankverbindung</DatenArt>`,
    `<Vorgang>send-Auth</Vorgang>`,
    ...(input.test ? [`<Testmerker>${TESTMERKER}</Testmerker>`] : []),
    `<Empfaenger id="L"><Ziel>${e(input.bundesland)}</Ziel></Empfaenger>`,
    `<HerstellerID>${e(input.herstellerId)}</HerstellerID>`,
    `<DatenLieferant>${e(datenlieferant)}</DatenLieferant>`,
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
    `<AenderungBankverbindung xmlns="http://finkonsens.de/elster/elsternachricht/aenderungbankverbindung/v20" version="20">`,
    `<Ordnungsbegriff>`,
    `<Steuernummer>${input.steuernummer13}</Steuernummer>`,
    `</Ordnungsbegriff>`,
    `<Persoenliche_Daten>`,
    `<Person_A>`,
    `<Identifikationsnummer>${p.idnr}</Identifikationsnummer>`,
    `<Anrede>${e(p.anrede)}</Anrede>`,
    `<Vorname>${e(p.vorname.trim())}</Vorname>`,
    `<Name>${e(p.name.trim())}</Name>`,
    `<Geburtsdatum>${germanDate(p.geburtsdatum)}</Geburtsdatum>`,
    `</Person_A>`,
    `</Persoenliche_Daten>`,
    `<Aenderung_der_Bankverbindung>`,
    `<Bankverbindungen>`,
    `<Bankverbindung>`,
    `<IBAN>${iban}</IBAN>`,
    `<Kontoinhaber>Person_A</Kontoinhaber>`,
    `<Steuerarten>`,
    `<Steuerart>Alle (übrigen)</Steuerart>`,
    `</Steuerarten>`,
    `</Bankverbindung>`,
    `</Bankverbindungen>`,
    `</Aenderung_der_Bankverbindung>`,
    `</AenderungBankverbindung>`,
    `</Nutzdaten>`,
    `</Nutzdatenblock>`,
    `</DatenTeil>`,
    `</Elster>`,
  ].join("\n");
}
