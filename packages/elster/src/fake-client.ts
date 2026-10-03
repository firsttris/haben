/**
 * NICHT ECHT: Ersatz für ERiC in Entwicklung und Tests (kein ERIC_HOME gesetzt).
 * Es wird nichts übermittelt; Ticket und Protokoll sind erfunden.
 */
import { randomBytes } from "node:crypto";
import { buildVastAnfrageXml, type VastXmlInput } from "./vast.ts";
import { failure, type BelegabrufResult, type ElsterClient, type ElsterResult, type PostfachOptions, type PostfachResult, type SendOptions } from "./types.ts";
import { hasTestmerker } from "./xml.ts";

export const FAKE_HINWEIS = "Testprotokoll – keine echte Übermittlung";

export class FakeElsterClient implements ElsterClient {
  readonly isFake = true;

  async validate(xml: string): Promise<ElsterResult> {
    const fehler = checkXml(xml);
    if (fehler) return { ...failure(fehler, 610001002), responseXml: fakeResponse(fehler) };
    return { ok: true, code: 0, message: "Validierung erfolgreich (Fake, ohne ERiC).", responseXml: fakeResponse(), serverResponseXml: "" };
  }

  async send(xml: string, certificate: Uint8Array, pin: string, options: SendOptions): Promise<ElsterResult> {
    const validation = await this.validate(xml);
    if (!validation.ok) return validation;
    if (hasTestmerker(xml) !== options.test) return failure("Testmerker im XML passt nicht zur Option test.");
    if (certificate.byteLength === 0) return failure("Kein Zertifikat übergeben.");
    if (pin.length === 0) return failure("Keine PIN übergeben.");

    const transferTicket = `fake-${randomBytes(8).toString("hex")}`;
    return {
      ok: true,
      code: 0,
      message: "Übermittlung simuliert (Fake, nichts wurde an ELSTER gesendet).",
      responseXml: fakeResponse(),
      serverResponseXml:
        `<?xml version="1.0" encoding="UTF-8"?><Elster><TransferHeader><TransferTicket>${transferTicket}</TransferTicket>` +
        `</TransferHeader></Elster>`,
      transferTicket,
      ...(options.print === false ? {} : { pdf: fakeProtokollPdf() }),
    };
  }

  /** Liefert immer denselben erfundenen Bescheid, damit sich die Oberfläche ohne ERiC ausprobieren lässt. */
  async fetchPostfach(xml: string, certificate: Uint8Array, pin: string, options: PostfachOptions): Promise<PostfachResult> {
    const leer = { bereitstellungen: [], dateien: [] };
    const sent = await this.send(xml, certificate, pin, { test: options.test, print: false });
    if (!sent.ok) return { ...sent, ...leer };
    if (!/<DatenArt>PostfachAnfrage<\/DatenArt>/.test(xml)) return { ...failure("Keine PostfachAnfrage."), ...leer };
    const jahr = String(new Date().getFullYear() - 1);
    return {
      ...sent,
      message: "Postfach simuliert (Fake, nichts wurde bei ELSTER abgeholt).",
      bereitstellungen: [
        {
          id: `fake-bereitstellung-${jahr}`,
          datenart: "DivaBescheidESt",
          groesse: 1,
          veranlagungszeitraum: jahr,
          steuernummer: "",
          bescheiddatum: `${jahr}-12-01`,
          anhaenge: [{ dateibezeichnung: "Testbescheid", dateityp: "application/pdf", referenzId: `fake-anhang-${jahr}`, groesse: 1 }],
        },
      ],
      dateien: [{ referenzId: `fake-anhang-${jahr}`, inhalt: fakeProtokollPdf() }],
    };
  }

  /** Liefert zwei erfundene Belege im Aufbau der ELSTER-Beispiele (Rentenbezugsmitteilung, persönliche Daten). */
  async fetchBelege(input: VastXmlInput, certificate: Uint8Array, pin: string): Promise<BelegabrufResult> {
    const leer = { requestXml: "", liste: [], belege: [] };
    let requestXml: string;
    try {
      requestXml = buildVastAnfrageXml(input);
    } catch (error) {
      return { ...failure(error instanceof Error ? error.message : String(error)), ...leer };
    }
    const sent = await this.send(requestXml, certificate, pin, { test: input.test, print: false });
    if (!sent.ok) return { ...sent, ...leer, requestXml };
    const jahr = input.veranlagungsjahr;
    const belege = [
      {
        ref: { id: `fake-rbm-${jahr}`, belegart: "VaSt_RBM", groesse: 1, hashwert: "", schemaversion: "202001" },
        xml:
          `<?xml version="1.0" encoding="UTF-8"?><VaSt_RBM version="202001"><Eingangsdatum>01.03.${jahr + 1} 00:00:00</Eingangsdatum>` +
          `<LeistungsEmpfaenger><IdNr>${input.idnr}</IdNr><Vorname>ERIKA</Vorname><Name>MUSTER</Name></LeistungsEmpfaenger>` +
          `<Mitteilung><Zuflussjahr>${jahr}</Zuflussjahr><MitteilungsPflichtigerName>Testrentenkasse (Fake)</MitteilungsPflichtigerName>` +
          `<Leistung><Waehrung>EUR</Waehrung><Teilleistung><Grundlage>01</Grundlage><Betrag>1200.00</Betrag></Teilleistung></Leistung>` +
          `<Krankenversicherung><Beitragsart>01</Beitragsart><Beginn>01</Beginn><Ende>12</Ende><Jahr>${jahr}</Jahr><Betrag>98.40</Betrag></Krankenversicherung>` +
          `</Mitteilung></VaSt_RBM>`,
      },
      {
        ref: { id: `fake-pers1-${jahr}`, belegart: "VaSt_Pers1", groesse: 1, hashwert: "", schemaversion: "4" },
        xml:
          `<?xml version="1.0" encoding="UTF-8"?><Belege><VaSt_Pers1 version="4"><Inhaber><NatPers><Vorname>ERIKA</Vorname><Name>MUSTER</Name>` +
          `<SteuerIDs><PersIdNr>${input.idnr}</PersIdNr></SteuerIDs><AdrKette><StrAdr><Str>Teststraße</Str><HausNr>1</HausNr>` +
          `<Plz>12345</Plz><Ort>Testort</Ort></StrAdr></AdrKette></NatPers></Inhaber></VaSt_Pers1></Belege>`,
      },
    ];
    return {
      ...sent,
      message: "Belegabruf simuliert (Fake, nichts wurde bei ELSTER abgeholt).",
      requestXml,
      liste: belege.map((b) => b.ref),
      belege: belege.map((b) => ({ id: b.ref.id, xml: b.xml })),
    };
  }
}

function fakeResponse(fehler?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><EricBearbeiteVorgang><Fake>true</Fake>${
    fehler ? `<FehlerRegelpruefung><Text>${fehler}</Text></FehlerRegelpruefung>` : ""
  }</EricBearbeiteVorgang>`;
}

/** Minimalprüfung: Tags korrekt verschachtelt, Wurzel Elster, bei der Voranmeldung Kz83 vorhanden. */
export function checkXml(xml: string): string | undefined {
  const body = xml.replace(/^\s*<\?xml[^>]*\?>/, "").trim();
  if (!body.startsWith("<Elster")) return "Wurzelelement Elster fehlt.";
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>/g;
  for (let match = tag.exec(body); match; match = tag.exec(body)) {
    const [, closing, name = "", selfClosing] = match;
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else if (stack.pop() !== name) return `Fehlerhafte Verschachtelung bei </${name}>.`;
  }
  if (stack.length > 0) return `Nicht geschlossenes Element <${stack.at(-1)}>.`;
  if (/<DatenArt>UStVA<\/DatenArt>/.test(body) && !/<Kz83>[^<]+<\/Kz83>/.test(body)) return "Kennzahl 83 fehlt.";
  return undefined;
}

/** Einseitiges PDF mit dem Hinweis, dass nichts übermittelt wurde. */
export function fakeProtokollPdf(): Uint8Array {
  // WinAnsiEncoding: \226 = Halbgeviertstrich, \334 = Ü
  const text = "Testprotokoll \\226 keine echte \\334bermittlung";
  const content = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
