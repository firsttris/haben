import { describe, expect, it } from "vitest";
import { parseTransferTicket } from "./ticket.ts";

describe("parseTransferTicket", () => {
  it("liest das Ticket aus der Serverantwort", () => {
    const xml = `<?xml version="1.0"?><Elster xmlns="http://www.elster.de/elsterxml/schema/v11"><TransferHeader version="11">
      <TransferTicket>et7a1b2c3d4e5f</TransferTicket></TransferHeader></Elster>`;
    expect(parseTransferTicket(xml)).toBe("et7a1b2c3d4e5f");
  });

  it("versteht Namensraum-Präfixe und Leerraum", () => {
    expect(parseTransferTicket("<e:TransferTicket>\n  abc \n</e:TransferTicket>")).toBe("abc");
  });

  it("gibt undefined ohne Ticket", () => {
    expect(parseTransferTicket("")).toBeUndefined();
    expect(parseTransferTicket("<TransferTicket></TransferTicket>")).toBeUndefined();
  });
});
