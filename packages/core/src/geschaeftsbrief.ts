import { isKapitalgesellschaft, RECHTSFORMEN, type Rechtsform } from "./rechtsform.ts";

/*
 * Pflichtangaben einer GmbH oder UG auf Geschäftsbriefen nach § 35a Abs. 1 GmbHG: Rechtsform und Sitz, Registergericht
 * des Sitzes und Nummer der Eintragung ins Handelsregister, alle Geschäftsführer und, falls ein Aufsichtsrat mit
 * Vorsitzendem gebildet ist, dessen Vorsitzender, jeweils mit Familiennamen und mindestens einem ausgeschriebenen
 * Vornamen. Rechnungen und E-Mails an einen bestimmten Empfänger sind Geschäftsbriefe in diesem Sinn.
 * Angaben zum Kapital sind nicht Pflicht (§ 35a Abs. 1 Satz 2 GmbHG: nur wenn überhaupt welche gemacht werden);
 * Haben macht keine. Fehlende Angaben setzt das Registergericht mit Zwangsgeld durch (§ 79 Abs. 1 GmbHG).
 * Quelle: https://www.gesetze-im-internet.de/gmbhg/__35a.html
 */

/** Pflichtangaben für den Fuß von Rechnung, Angebot, Mahnung und anderen Briefen sowie für E-Mails */
export interface LegalInfo {
  /** Nur gesetzt, wenn der Firmenname die Rechtsform nicht schon nennt */
  legalForm?: string;
  /** Sitz laut Gesellschaftsvertrag */
  seat: string;
  registerCourt: string;
  registerNumber: string;
  managingDirectors: string[];
  supervisoryBoardChair?: string;
}

/** Was aus den Firmendaten in die Pflichtangaben eingeht */
export interface LegalInfoSource {
  name: string;
  rechtsform: Rechtsform;
  sitz: string;
  ort: string;
  registergericht: string;
  registernummer: string;
  /** Ein Name je Zeile */
  geschaeftsfuehrer: string;
  aufsichtsratVorsitz: string;
}

/** Geschäftsführer aus dem Feld der Firmendaten: ein Name je Zeile, Leerzeilen zählen nicht */
export function managingDirectorList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/**
 * Nennt der Firmenname die Rechtsform? Eine GmbH muss „Gesellschaft mit beschränkter Haftung“ oder eine verständliche
 * Abkürzung führen (§ 4 GmbHG), eine UG „Unternehmergesellschaft (haftungsbeschränkt)“ oder „UG (haftungsbeschränkt)“
 * (§ 5a Abs. 1 GmbHG).
 */
export function nameShowsLegalForm(name: string, rechtsform: Rechtsform): boolean {
  if (rechtsform === "gmbh") return /gmbh|gesellschaft mit beschränkter haftung/i.test(name);
  if (rechtsform === "ug") return /(ug|unternehmergesellschaft)\s*\(haftungsbeschränkt\)/i.test(name);
  return true;
}

/**
 * Familienname und mindestens ein ausgeschriebener Vorname: vor dem letzten Wort ein Wort ohne Abkürzungspunkt mit
 * mindestens zwei Buchstaben. „Dr. Erika Muster“ genügt, „E. Muster“ und „Muster“ nicht.
 */
export function hasWrittenOutFirstName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  return words.slice(0, -1).some((word) => !word.endsWith(".") && /\p{L}{2,}/u.test(word));
}

/** Pflichtangaben aus den Firmendaten; ohne GmbH oder UG keine */
export function legalInfo(source: LegalInfoSource): LegalInfo | undefined {
  if (!isKapitalgesellschaft(source.rechtsform)) return undefined;
  const chair = source.aufsichtsratVorsitz.trim();
  return {
    ...(nameShowsLegalForm(source.name, source.rechtsform) ? {} : { legalForm: RECHTSFORMEN[source.rechtsform] }),
    // Leerer Sitz heißt in den Firmendaten: Ort der Anschrift
    seat: source.sitz.trim() || source.ort.trim(),
    registerCourt: source.registergericht.trim(),
    registerNumber: source.registernummer.trim(),
    managingDirectors: managingDirectorList(source.geschaeftsfuehrer),
    ...(chair ? { supervisoryBoardChair: chair } : {}),
  };
}

/** Was an Pflichtangaben nach § 35a Abs. 1 GmbHG fehlt; leer bei vollständigen Angaben und beim Einzelunternehmen */
export function legalInfoGaps(source: LegalInfoSource): string[] {
  const info = legalInfo(source);
  if (!info) return [];
  const gaps: string[] = [];
  if (!info.seat) gaps.push("Sitz fehlt");
  if (!info.registerCourt) gaps.push("Registergericht fehlt");
  if (!info.registerNumber) gaps.push("Registernummer fehlt");
  if (info.managingDirectors.length === 0) gaps.push("Geschäftsführer fehlt");
  for (const name of [...info.managingDirectors, ...(info.supervisoryBoardChair ? [info.supervisoryBoardChair] : [])]) {
    if (!hasWrittenOutFirstName(name)) gaps.push(`„${name}“: Familienname und ausgeschriebener Vorname`);
  }
  return gaps;
}
