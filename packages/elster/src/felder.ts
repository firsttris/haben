/*
 * Die Feldkennungen einer Erklärung mit ihren Werten, für das Ausfüllen in Mein ELSTER. Mein ELSTER nennt seine
 * Eingabefelder nach denselben Kennungen wie das ERiC-XML (EÜR 2025: „fields[eruEUERBEinUSt_StPflichtSumE6000401]“,
 * USt 2025: „fields[eruUSt2AUmsaetzeTabelleUms_allgE3003303]“). Die Werte kommen deshalb aus genau dem XML, das Haben
 * über ERiC senden würde; so laufen Versand und Ausfüllen nicht auseinander.
 */

/**
 * Hersteller-ID für ein XML, aus dem nur die Felder gelesen werden (elsterFelder). Sie steht allein im Transferkopf,
 * den elsterFelder verwirft; ein Versand mit ihr scheitert, weil es keine gültige ID ist.
 */
export const NUR_AUSLESEN = "00000";

export interface ElsterFeld {
  /** Feldkennung, z. B. "E6000401", bei der Voranmeldung die Kennzahl, z. B. "Kz81" */
  kennung: string;
  /** Wert wie im XML: "1234,56", "1234", Schlüssel wie "1" oder Text */
  wert: string;
  /** Abschnitte von den Nutzdaten bis zum Feld, z. B. ["E77", "EUER", "BEin"] */
  pfad: string[];
  /**
   * Nummer der Zeile (ab 1), wenn das Feld in einem Abschnitt steht, der mehrfach vorkommt (Anlagegüter, Kinder);
   * null bei einfachen Feldern. Mehrfachzeilen legt man in Mein ELSTER erst an, bevor man sie füllt.
   */
  zeile: number | null;
  /**
   * Person, zu der das Feld gehört, wenn sein Abschnitt eine Person nennt (<Person>PersonA</Person> in Anlage S, N,
   * Vorsorgeaufwand der ESt): "A" oder "B"; sonst null. Mein ELSTER führt diese Anlagen je Person.
   */
  person: "A" | "B" | null;
}

/** Feldkennungen der Erklärungen (E6000401) und Kennzahlen der Voranmeldung (Kz81) */
const KENNUNG = /^(E\d{7}|Kz\d{2})$/;
const TOKEN = /<(\/?)([A-Za-z_][\w.-]*)(?:\s[^>]*?)?(\/?)>|([^<]+)/g;

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Ein Abschnitt: wievielter seines Namens unter demselben Elternteil, und für welche Person er steht */
interface Abschnitt {
  /** Elternteil und Name, z. B. "7/Kind" */
  gruppe: string;
  index: number;
  /** aus einem Kindelement <Person>PersonA</Person>; wird gesetzt, sobald es gelesen ist */
  person: "A" | "B" | null;
}

interface Roh {
  kennung: string;
  wert: string;
  pfad: string[];
  abschnitte: Abschnitt[];
}

const PERSON = /^Person([AB])$/;

/** Zerlegt die Nutzdaten in Felder mit ihren Abschnitten und zählt, wie oft jeder Abschnitt vorkommt */
function lesen(body: string): { felder: Roh[]; anzahl: Map<string, number> } {
  const felder: Roh[] = [];
  const anzahl = new Map<string, number>();
  let naechsteId = 1;
  const stack: { id: number; name: string; abschnitt: Abschnitt | null }[] = [{ id: 0, name: "", abschnitt: null }];
  let text = "";
  for (const [, closing, name, selfClosing, chars] of body.matchAll(TOKEN)) {
    if (chars !== undefined) {
      text += chars;
      continue;
    }
    if (closing) {
      const node = stack.pop()!;
      const person = node.name === "Person" ? PERSON.exec(text.trim()) : null;
      const eltern = stack[stack.length - 1]?.abschnitt;
      if (person && eltern) eltern.person = person[1] as "A" | "B";
      if (KENNUNG.test(node.name)) {
        felder.push({
          kennung: node.name,
          wert: decode(text.trim()),
          pfad: stack.slice(1).map((s) => s.name),
          abschnitte: stack.flatMap((s) => (s.abschnitt ? [s.abschnitt] : [])),
        });
      }
      text = "";
      continue;
    }
    text = "";
    if (selfClosing) continue;
    const gruppe = `${stack[stack.length - 1]!.id}/${name}`;
    const index = anzahl.get(gruppe) ?? 0;
    anzahl.set(gruppe, index + 1);
    stack.push({ id: naechsteId++, name: name!, abschnitt: KENNUNG.test(name!) ? null : { gruppe, index, person: null } });
  }
  return { felder, anzahl };
}

/**
 * Liest alle Felder mit Kennung aus den Nutzdaten eines ERiC-XML; der Transferkopf bleibt außen vor. Ein Abschnitt,
 * der unter demselben Elternteil mehrfach vorkommt, ist eine Mehrfachzeile; seine Felder tragen deren Nummer. Steht
 * der Abschnitt dagegen je Person (Anlage N für Person A und B), ist er keine Mehrfachzeile, sondern trägt die Person.
 */
export function elsterFelder(xml: string): ElsterFeld[] {
  const start = xml.indexOf("<Nutzdaten>");
  const end = xml.indexOf("</Nutzdaten>");
  const body = start >= 0 && end > start ? xml.slice(start + "<Nutzdaten>".length, end) : xml.replace(/<\?[^>]*\?>/g, "");
  const { felder, anzahl } = lesen(body);
  return felder.map(({ abschnitte, ...feld }) => {
    const person = abschnitte.findLast((a) => a.person)?.person ?? null;
    const mehrfach = abschnitte.filter((a) => !a.person && (anzahl.get(a.gruppe) ?? 0) > 1).at(-1);
    return { ...feld, zeile: mehrfach ? mehrfach.index + 1 : null, person };
  });
}

// ------------------------------------------------------------------ Werte für Mein ELSTER

export const MEIN_ELSTER_FORMAT = "haben-mein-elster";

/** Formular, wie es im Pfad von Mein ELSTER heißt: /eportal/interpreter/eingabe/<formular>-<jahr>/… */
export type MeinElsterFormular = "ustvaeru" | "ust" | "euer" | "est";

/** Was die Erweiterung apps/elster-helfer einliest */
export interface MeinElsterWerte {
  format: typeof MEIN_ELSTER_FORMAT;
  version: 1;
  formular: MeinElsterFormular;
  jahr: number;
  /** Voranmeldungszeitraum, z. B. "10"; null bei Jahreserklärungen */
  zeitraum: string | null;
  /**
   * Namen der Personen, wie Mein ELSTER sie über die Anlagen je Person schreibt („Anlage S (Erika Muster)“); nur bei
   * der Einkommensteuer. Daran erkennt die Erweiterung, wessen Anlage gerade offen ist.
   */
  personen: { A: string; B: string | null } | null;
  erstellt: string;
  felder: ElsterFeld[];
}

/**
 * Die Werte für Mein ELSTER aus dem XML, das Haben über ERiC senden würde. Bei der Voranmeldung schreibt das XML
 * Steuerbeträge mit Punkt („173.55“), Mein ELSTER erwartet ein Komma; Kz 09 (Hersteller-ID) gehört nicht ins Formular.
 * Den Zeitraum der Voranmeldung wählt man in Mein ELSTER auf der Startseite; er kommt als Feld „Zeitraum“ mit.
 */
export function meinElsterWerte(
  formular: MeinElsterFormular,
  jahr: number,
  xml: string,
  now: Date,
  extra: { zeitraum?: string | null; personen?: MeinElsterWerte["personen"] } = {},
): MeinElsterWerte {
  const zeitraum = extra.zeitraum ?? null;
  let felder = elsterFelder(xml);
  if (formular === "ustvaeru") {
    felder = felder.filter((f) => f.kennung !== "Kz09").map((f) => ({ ...f, wert: f.wert.replace(/^(-?\d+)\.(\d{2})$/, "$1,$2") }));
    if (zeitraum)
      felder = [
        { kennung: "Zeitraum", wert: zeitraum, pfad: ["Anmeldungssteuern", "Steuerfall", "Umsatzsteuervoranmeldung"], zeile: null, person: null },
        ...felder,
      ];
  }
  return { format: MEIN_ELSTER_FORMAT, version: 1, formular, jahr, zeitraum, personen: extra.personen ?? null, erstellt: now.toISOString(), felder };
}
