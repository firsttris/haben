import { describe, expect, it } from "vitest";
import { parseTransferTicket, TRANSFERTICKET_MUSTER, transferticketProblem } from "./ticket.ts";

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

describe("transferticketProblem", () => {
  it("lässt die Tickets aus dem Übermittlungsprotokoll durch", () => {
    // So vergeben ELSTER und die Testumgebung: Buchstaben und Ziffern, teils mit Bindestrich
    for (const ticket of ["et7a1b2c3d4e5f", "ABC123456789", "et-2026-0001234", "e2.a9"]) {
      expect(transferticketProblem(ticket)).toBeNull();
      expect(TRANSFERTICKET_MUSTER.test(ticket)).toBe(true);
    }
  });

  it("nimmt Leerraum um das Ticket nicht übel", () => {
    expect(transferticketProblem("  ABC123456789\n")).toBeNull();
  });

  it("lehnt Zeichen ab, die in keinem Ticket stehen", () => {
    const meldung = "Bitte das Transferticket aus dem Übermittlungsprotokoll angeben (Buchstaben und Ziffern).";
    for (const ticket of ["!!!!------", "AB 1234 5678", "<b>1234</b>", "äöü-123456"]) expect(transferticketProblem(ticket)).toBe(meldung);
  });

  it("lehnt zu kurze und zu lange Tickets ab", () => {
    expect(transferticketProblem("abc")).not.toBeNull();
    expect(transferticketProblem("a".repeat(65))).not.toBeNull();
    expect(transferticketProblem("a".repeat(64))).toBeNull();
  });
});
