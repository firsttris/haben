import { XMLParser } from "fast-xml-parser";
import { findDeep, int, type Node, text } from "./xml-lesen.ts";

/**
 * Rückmeldungen des ELSTER-Annahmeservers aus der gespeicherten Serverantwort. TransferHeader und jeder
 * NutzdatenHeader tragen ein RC mit Rueckgabe (Code, Text) und Stack (Code, Text); Code 0 heißt angenommen.
 * Aufbau nach den Beispielantworten von erica (digitalservicebund, MIT). ERiC meldet bei einem Fehler des
 * Servers nur einen allgemeinen Text zum Rückgabecode; was der Server genau bemängelt, steht erst hier.
 */

export interface ServerRueckmeldung {
  quelle: "Transferheader" | "Nutzdatenheader";
  code: number;
  text: string;
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

const parse = (xml: string): unknown => {
  if (!xml.trim()) return {};
  try {
    return parser.parse(xml);
  } catch {
    return {};
  }
};

const leerraum = (value: string) => value.replace(/\s+/g, " ").trim();

function ausHeader(header: Node, quelle: ServerRueckmeldung["quelle"]): ServerRueckmeldung[] {
  const rc = findDeep(header, "RC")[0];
  if (!rc) return [];
  const gefunden: ServerRueckmeldung[] = [];
  for (const name of ["Rueckgabe", "Stack"]) {
    const eintrag = findDeep(rc, name)[0];
    const code = eintrag ? int(eintrag.Code) : 0;
    if (!eintrag || code === 0) continue;
    const meldung = leerraum(text(eintrag.Text));
    // Der Stack wiederholt oft den Code der Rückgabe, meist ohne Text; neu ist nur ein anderer Code oder Text
    if (gefunden.some((g) => g.code === code && (meldung === "" || g.text === meldung))) continue;
    gefunden.push({ quelle, code, text: meldung });
  }
  return gefunden;
}

/** Fehler im TransferHeader und in den NutzdatenHeadern, in der Reihenfolge der Antwort; leer bei Erfolg oder ohne Antwort */
export function serverRueckmeldungen(serverResponseXml: string): ServerRueckmeldung[] {
  const doc = parse(serverResponseXml);
  return [
    ...findDeep(doc, "TransferHeader").flatMap((header) => ausHeader(header, "Transferheader")),
    ...findDeep(doc, "NutzdatenHeader").flatMap((header) => ausHeader(header, "Nutzdatenheader")),
  ];
}

/** Die Meldung von ERiC, ergänzt um Code und Text des Servers; unverändert, wenn der Server nichts meldet */
export function mitServerMeldung(message: string, serverResponseXml: string): string {
  const meldungen = serverRueckmeldungen(serverResponseXml);
  if (meldungen.length === 0) return message;
  const zeilen = meldungen.map((m) => `${m.quelle} ${m.code}${m.text ? ` – ${m.text}` : ""}`);
  return `${message} Antwort des ELSTER-Servers: ${zeilen.join("; ")}`;
}
