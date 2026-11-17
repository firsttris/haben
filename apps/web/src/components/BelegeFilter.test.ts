import { describe, expect, it } from "vitest";
import { filterBelege, leerSatz, sucheBelege } from "./BelegeFilter.tsx";

const documents = [
  { id: "a", status: "neu" as const },
  { id: "b", status: "gebucht" as const },
  { id: "c", status: "gebucht" as const, cancelledOn: "2026-01-02" },
];

describe("filterBelege", () => {
  it("zeigt ohne Filter alle Belege", () => {
    expect(filterBelege(documents, undefined)).toEqual(documents);
  });

  it("„Zu prüfen“ zeigt nur ungebuchte Belege", () => {
    expect(filterBelege(documents, "pruefen").map((d) => d.id)).toEqual(["a"]);
  });

  it("„Gebucht“ zeigt auch stornierte Belege, die im Code gebucht bleiben", () => {
    expect(filterBelege(documents, "gebucht").map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("liefert bei keinem Treffer eine leere Liste", () => {
    expect(filterBelege([documents[0]!], "gebucht")).toEqual([]);
  });
});

describe("sucheBelege", () => {
  const belege = [
    { supplierName: "Nordlicht GmbH", invoiceNumber: "NL-1", filename: "a.jpg", gross: 11_900, status: "neu" as const },
    { supplierName: "Codewerk", invoiceNumber: null, filename: "Rechnung-7.pdf", gross: 5_000, status: "gebucht" as const },
  ];

  it("findet nach Lieferant, Belegnummer und Dateiname ohne auf Groß- und Kleinschreibung zu achten", () => {
    expect(sucheBelege(belege, "nordlicht")).toEqual([belege[0]]);
    expect(sucheBelege(belege, "NL-1")).toEqual([belege[0]]);
    expect(sucheBelege(belege, "rechnung-7")).toEqual([belege[1]]);
  });

  it("findet nach dem Betrag", () => {
    expect(sucheBelege(belege, "119,00")).toEqual([belege[0]]);
  });

  it("lässt ein leeres Suchfeld alles zeigen", () => {
    expect(sucheBelege(belege, "  ")).toEqual(belege);
  });

  it("sucht nur unter dem gewählten Filter", () => {
    expect(sucheBelege(filterBelege(belege, "pruefen"), "Codewerk")).toEqual([]);
  });
});

describe("leerSatz", () => {
  it("nennt mit Filter den Stand des Filters", () => {
    expect(leerSatz("pruefen", true)).toContain("Alles geprüft");
    expect(leerSatz("gebucht", true)).toContain("Noch kein Beleg gebucht");
  });

  it("lässt Nutzer ohne Hochladen nur den kurzen Satz sehen", () => {
    expect(leerSatz(undefined, false)).toBe("Noch keine Belege.");
  });

  it("verspricht keine Auslesung, die ohne KI nicht stattfindet, und kein Ziehen am Handy", () => {
    const satz = leerSatz(undefined, true);
    expect(satz).toContain("Stromrechnung");
    expect(satz).not.toMatch(/liest Haben|liest die Angaben|Ziehe/);
  });
});
