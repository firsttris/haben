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
  /** Feldkennung, z. B. "E6000401" */
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
}

const KENNUNG = /^E\d{7}$/;
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

/** Ein Abschnitt: wievielter seines Namens unter demselben Elternteil */
interface Abschnitt {
  /** Elternteil und Name, z. B. "7/Kind" */
  gruppe: string;
  index: number;
}

interface Roh {
  kennung: string;
  wert: string;
  pfad: string[];
  abschnitte: Abschnitt[];
}

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
    stack.push({ id: naechsteId++, name: name!, abschnitt: KENNUNG.test(name!) ? null : { gruppe, index } });
  }
  return { felder, anzahl };
}

/**
 * Liest alle Felder mit Kennung aus den Nutzdaten eines ERiC-XML; der Transferkopf bleibt außen vor. Ein Abschnitt,
 * der unter demselben Elternteil mehrfach vorkommt, ist eine Mehrfachzeile; seine Felder tragen deren Nummer.
 */
export function elsterFelder(xml: string): ElsterFeld[] {
  const start = xml.indexOf("<Nutzdaten>");
  const end = xml.indexOf("</Nutzdaten>");
  const body = start >= 0 && end > start ? xml.slice(start + "<Nutzdaten>".length, end) : xml.replace(/<\?[^>]*\?>/g, "");
  const { felder, anzahl } = lesen(body);
  return felder.map(({ abschnitte, ...feld }) => {
    const mehrfach = abschnitte.filter((a) => (anzahl.get(a.gruppe) ?? 0) > 1).at(-1);
    return { ...feld, zeile: mehrfach ? mehrfach.index + 1 : null };
  });
}
