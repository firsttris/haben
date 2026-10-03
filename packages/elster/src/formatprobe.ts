import { buildSpezRechtAntragXml, buildSpezRechtFreischaltungXml, buildSpezRechtListeXml, buildSpezRechtStornoXml } from "./berechtigung.ts";
import { buildPostfachAnfrageXml, buildPostfachBestaetigungXml } from "./postfach.ts";
import type { ElsterClient } from "./types.ts";
import { buildVastAbholungXml, buildVastAnfrageXml } from "./vast.ts";
import { datenartVersionFromXml } from "./xml.ts";

/**
 * Prüft die Nachrichten, deren Schemas Haben nicht aus der Jahresdokumentation kennt, sondern aus freien
 * Projekten (erica, viking): Belegabruf, Berechtigungsmanagement und Postfach. ERiC validiert sie lokal gegen
 * die eingebauten Schemas, ohne etwas zu senden. Veraltete Versionen oder Feldnamen fallen so sofort auf.
 */

export interface FormatProbeInput {
  /** Steuer-IdNr für Belegabruf und Antrag; nur zum Prüfen, es wird nichts gesendet */
  idnr: string;
  geburtsdatum: string;
  datenlieferant: string;
  herstellerId: string;
  veranlagungsjahr: number;
  produktVersion: string;
}

export interface FormatProbe {
  name: string;
  xml: string;
}

/** Eine Probe je Nachricht, aufgebaut wie beim echten Senden (ohne Testmerker) */
export function formatProben(input: FormatProbeInput): FormatProbe[] {
  const base = { datenlieferant: input.datenlieferant, herstellerId: input.herstellerId, test: false };
  const vast = { ...base, idnr: input.idnr, veranlagungsjahr: input.veranlagungsjahr };
  const antragsId = "br1272xf3i59m2323ft9qtk7iqzxzke4";
  const postfach = { ...base, produktVersion: input.produktVersion };
  return [
    { name: "Belegabruf: Liste anfragen", xml: buildVastAnfrageXml(vast) },
    { name: "Belegabruf: Belege abholen", xml: buildVastAbholungXml(["vb3077iudj6nrd6h5istk3c3mzbbi88r"], vast) },
    {
      name: "Berechtigung beantragen",
      xml: buildSpezRechtAntragXml({
        ...base,
        dateninhaberIdnr: input.idnr,
        dateninhaberGeburtsdatum: input.geburtsdatum,
        gueltigBis: `${input.veranlagungsjahr + 3}-12-31`,
        mail: "test@example.com",
      }),
    },
    { name: "Berechtigung freischalten", xml: buildSpezRechtFreischaltungXml(antragsId, "ABCD-EFGH-1234", base) },
    { name: "Berechtigung widerrufen", xml: buildSpezRechtStornoXml(antragsId, base) },
    { name: "Berechtigungen auflisten", xml: buildSpezRechtListeXml(base) },
    { name: "Postfach abfragen", xml: buildPostfachAnfrageXml(postfach) },
    { name: "Postfach-Abholung bestätigen", xml: buildPostfachBestaetigungXml(["fake-bereitstellung"], postfach) },
  ];
}

/** Texte aller Meldungen aus dem Rückgabepuffer von ERiC, ohne Doppelte */
export function ericMeldungen(responseXml: string): string[] {
  const texte = [...responseXml.matchAll(/<Text>([\s\S]*?)<\/Text>/g)].map((m) =>
    m[1]!
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return [...new Set(texte.filter(Boolean))];
}

export interface FormatProbeResult {
  name: string;
  datenartVersion: string;
  ok: boolean;
  code: number;
  message: string;
  meldungen: string[];
}

/** Validiert alle Proben nacheinander; jede in einem eigenen ERiC-Prozess */
export async function checkFormats(client: ElsterClient, input: FormatProbeInput): Promise<FormatProbeResult[]> {
  const results: FormatProbeResult[] = [];
  for (const probe of formatProben(input)) {
    const result = await client.validate(probe.xml);
    results.push({
      name: probe.name,
      datenartVersion: datenartVersionFromXml(probe.xml) ?? "?",
      ok: result.ok,
      code: result.code,
      message: result.message,
      meldungen: result.ok ? [] : ericMeldungen(result.responseXml),
    });
  }
  return results;
}
