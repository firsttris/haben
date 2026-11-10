import { describe, expect, it } from "vitest";
import type { OutgoingMail } from "../transport.ts";
import { buildSendMailBody, MAX_ATTACHMENT_BYTES } from "./message.ts";

const mail: OutgoingMail = {
  from: { name: "Muster IT", address: "rechnung@firma.example" },
  to: "kunde@kunde.example",
  subject: "Rechnung 2026-001",
  text: "Text",
  html: "<p>Text</p>",
};

describe("Body für sendMail", () => {
  it("sendet HTML, den Absender und speichert in Gesendete Elemente", () => {
    const body = buildSendMailBody(mail);
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe("Rechnung 2026-001");
    expect(body.message.body).toEqual({ contentType: "HTML", content: "<p>Text</p>" });
    expect(body.message.from).toEqual({ emailAddress: { name: "Muster IT", address: "rechnung@firma.example" } });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "kunde@kunde.example" } }]);
    expect(body.message).not.toHaveProperty("bccRecipients");
    expect(body.message).not.toHaveProperty("replyTo");
    expect(body.message).not.toHaveProperty("attachments");
  });

  it("zerlegt mehrere Empfänger, Blindkopie und Antwortadresse", () => {
    const body = buildSendMailBody({
      ...mail,
      to: 'a@x.example, Berta Beispiel <b@x.example>; "C. Muster" <c@x.example>',
      bcc: "ich@firma.example",
      replyTo: "info@firma.example",
    });
    expect(body.message.toRecipients).toEqual([
      { emailAddress: { address: "a@x.example" } },
      { emailAddress: { address: "b@x.example", name: "Berta Beispiel" } },
      { emailAddress: { address: "c@x.example", name: "C. Muster" } },
    ]);
    expect(body.message.bccRecipients).toEqual([{ emailAddress: { address: "ich@firma.example" } }]);
    expect(body.message.replyTo).toEqual([{ emailAddress: { address: "info@firma.example" } }]);
  });

  it("hängt Anhänge als Base64 an, Text und Puffer", () => {
    const body = buildSendMailBody({
      ...mail,
      attachments: [
        { filename: "rechnung.pdf", content: Buffer.from("PDF-Bytes"), contentType: "application/pdf" },
        { filename: "rechnung.xml", content: "<xml/>", contentType: "application/xml" },
      ],
    });
    expect(body.message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "rechnung.pdf",
        contentType: "application/pdf",
        contentBytes: Buffer.from("PDF-Bytes").toString("base64"),
      },
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "rechnung.xml",
        contentType: "application/xml",
        contentBytes: Buffer.from("<xml/>").toString("base64"),
      },
    ]);
  });

  it("nimmt Anhänge bis zur Grenze und lehnt größere vor dem Senden ab", () => {
    const attachment = (size: number) => ({ filename: "gross.pdf", content: Buffer.alloc(size), contentType: "application/pdf" });
    expect(() => buildSendMailBody({ ...mail, attachments: [attachment(MAX_ATTACHMENT_BYTES)] })).not.toThrow();
    expect(() => buildSendMailBody({ ...mail, attachments: [attachment(MAX_ATTACHMENT_BYTES - 100), attachment(101)] })).toThrow(
      "Die Anhänge (2,5 MB) sind für den Versand über Microsoft 365 zu groß (höchstens 2,5 MB). Verkleinere die Anhänge oder verwende SMTP.",
    );
  });
});
