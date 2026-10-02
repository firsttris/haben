// Stub-Worker: antwortet mit einer Beschreibung der Anfrage.
import { statSync, writeFileSync } from "node:fs";

process.once("message", ({ config, request }) => {
  let certMode = null;
  if (request.certificatePath) certMode = statSync(request.certificatePath).mode & 0o777;
  if (request.pdfPath) writeFileSync(request.pdfPath, "%PDF-stub");
  const info = { config, op: request.op, datenartVersion: request.datenartVersion, certMode, pinOk: request.pin === "1234" };
  process.send(
    {
      type: "result",
      result: {
        code: 0,
        message: "OK",
        responseXml: JSON.stringify(info),
        serverResponseXml: "<TransferTicket>stub-ticket</TransferTicket>",
        transferTicket: "stub-ticket",
      },
    },
    () => process.exit(0),
  );
});
