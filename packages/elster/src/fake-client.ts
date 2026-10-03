/**
 * NICHT ECHT: Ersatz für ERiC in Entwicklung und Tests (kein ERIC_HOME gesetzt).
 * Es wird nichts übermittelt; Ticket und Protokoll sind erfunden.
 */
import { randomBytes } from "node:crypto";
import { failure, type ElsterClient, type ElsterResult, type SendOptions } from "./types.ts";
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
