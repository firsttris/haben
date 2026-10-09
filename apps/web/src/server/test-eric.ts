import { resolve } from "node:path";
import { datenartVersionFromXml, EricProcessClient, ericHomeIn, ericMeldungen, FakeElsterClient, type ElsterResult, type PostfachOptions, type PostfachResult, type SendOptions } from "@haben/elster";

/**
 * Fake-Client für Integrationstests, der jedes erzeugte XML zusätzlich vom echten ERiC prüfen lässt, sobald
 * ERiC da ist (ERIC_HOME oder ERIC_DIR). So laufen die Szenarien aus der Datenbank auch durch ERiCs Schemas
 * und Plausibilitätsprüfungen; gesendet wird nichts. Ohne ERiC verhält er sich wie der normale Fake.
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));
const echt = ericHome ? new EricProcessClient({ ericHome }) : null;

/** ERiC sperrt die Test-Hersteller-ID 74931 auch für die lokale Prüfung */
const mitPruefId = (xml: string) => xml.replace(/<HerstellerID>74931<\/HerstellerID>/, "<HerstellerID>12345</HerstellerID>").replace(/<Kz09>74931<\/Kz09>/, "<Kz09>12345</Kz09>");

export async function ericPruefen(xml: string): Promise<void> {
  if (!echt) return;
  const result = await echt.validate(mitPruefId(xml));
  if (!result.ok) {
    throw new Error(`ERiC lehnt ${datenartVersionFromXml(xml) ?? "die Nachricht"} ab: ${result.code} ${result.message}\n${ericMeldungen(result.responseXml).join("\n")}`);
  }
}

export class EricGeprueftClient extends FakeElsterClient {
  override async validate(xml: string): Promise<ElsterResult> {
    await ericPruefen(xml);
    return super.validate(xml);
  }

  override async send(xml: string, certificate: Uint8Array, pin: string, options: SendOptions): Promise<ElsterResult> {
    await ericPruefen(xml);
    return super.send(xml, certificate, pin, options);
  }

  override async fetchPostfach(xml: string, certificate: Uint8Array, pin: string, options: PostfachOptions): Promise<PostfachResult> {
    await ericPruefen(xml);
    return super.fetchPostfach(xml, certificate, pin, options);
  }
}
