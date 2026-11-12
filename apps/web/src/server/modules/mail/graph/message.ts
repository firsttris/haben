import { MailError } from "../errors.ts";
import type { OutgoingMail } from "../transport.ts";

/**
 * Anhänge gehen direkt im Request von `sendMail` mit. Microsoft nennt für einen Anhang im Request unter 3 MB, die
 * Grenze für den ganzen Request ist in der Doku nicht bestätigt; Base64 macht aus den Bytes ein Drittel mehr. Größeres
 * bräuchte eine Upload-Session und damit `Mail.ReadWrite`, das Haben nicht verlangt (docs/adr/mail-graph.md).
 */
export const MAX_ATTACHMENT_BYTES = 2_621_440;

interface Recipient {
  emailAddress: { address: string; name?: string };
}

/** „a@b.de, Name <c@d.de>; e@f.de“ → Empfänger; Trennzeichen Komma oder Semikolon */
function recipients(list: string): Recipient[] {
  return list
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const named = /^(.*)<([^<>]+)>$/.exec(part);
      if (!named) return { emailAddress: { address: part } };
      const name = named[1]!.trim().replace(/^"(.*)"$/, "$1");
      return { emailAddress: { address: named[2]!.trim(), ...(name ? { name } : {}) } };
    });
}

function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/**
 * Body für `POST /users/{postfach}/sendMail`. Der Textteil entfällt: Eine Nachricht hat in Graph genau einen Inhalt, Haben
 * sendet das HTML. Vor dem Senden geprüft, damit nichts halb ankommt.
 */
export function buildSendMailBody(mail: OutgoingMail) {
  const attachments = (mail.attachments ?? []).map((a) => ({
    name: a.filename,
    contentType: a.contentType,
    bytes: typeof a.content === "string" ? Buffer.from(a.content) : a.content,
  }));
  const total = attachments.reduce((sum, a) => sum + a.bytes.length, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new MailError(
      `Die Anhänge (${megabytes(total)} MB) sind für den Versand über Microsoft 365 zu groß (höchstens ${megabytes(MAX_ATTACHMENT_BYTES)} MB). Verkleinere die Anhänge oder verwende SMTP.`,
    );
  }
  return {
    message: {
      subject: mail.subject,
      body: { contentType: "HTML", content: mail.html },
      toRecipients: recipients(mail.to),
      ...(mail.bcc ? { bccRecipients: recipients(mail.bcc) } : {}),
      ...(mail.replyTo ? { replyTo: recipients(mail.replyTo) } : {}),
      from: { emailAddress: { name: mail.from.name, address: mail.from.address } },
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.bytes.toString("base64"),
            })),
          }
        : {}),
    },
    saveToSentItems: true,
  };
}
