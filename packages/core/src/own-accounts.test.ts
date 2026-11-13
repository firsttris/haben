import { describe, expect, it } from "vitest";
import { ebilanzPosition } from "./ebilanz.ts";
import { bereichPosten } from "./hgb.ts";
import { euerZuordnung } from "./journal-euer.ts";
import { GEWST_HINZURECHNUNG_KONTEN } from "./koerperschaft.ts";
import { ledgerManagedAccounts } from "./manual.ts";
import { ownAccountParents, ownAccountProblem, reservedAccountNumbers, resolveOwnAccount } from "./own-accounts.ts";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";

/*
 * Eigene Sachkonten (#270, Stufe 1): ein Aufwandskonto mit eigener Nummer und eigenem Namen, das für Steuer, EÜR und E-Bilanz
 * wie seine Elternkategorie zählt. Regeln für Nummer und Elternkategorie, und die Auflösung auf das Konto der Elternkategorie.
 */

const KR: Kontenrahmen[] = ["SKR03", "SKR04"];
const frei = { SKR03: "4999", SKR04: "6999" } as const;

describe.each(KR)("Elternkategorien (%s)", (kr) => {
  it("sind Aufwand mit Konto in der Aufwandsklasse des Kontenrahmens", () => {
    const klasse = kr === "SKR03" ? "4" : "6";
    for (const kategorie of ownAccountParents(kr)) expect(EXPENSE_CATEGORIES[kategorie][kr].startsWith(klasse), kategorie).toBe(true);
    expect(ownAccountParents(kr)).toContain("software");
    expect(ownAccountParents(kr)).toContain("bewirtung");
  });

  it("lassen Anlagen, Hardware, Einfuhrumsatzsteuer, Wareneinkauf, Fremdleistung, Kontoführung und Kfz-Steuer aus", () => {
    const parents = ownAccountParents(kr) as ExpenseCategory[];
    for (const k of ["anlage", "hardware", "einfuhrumsatzsteuer", "wareneinkauf", "fremdleistung", "geldverkehr", "kfzSteuer"] as const) {
      expect(parents, k).not.toContain(k);
    }
  });
});

describe.each(KR)("Prüfung beim Anlegen (%s)", (kr) => {
  const ok = { kontenrahmen: kr, account: frei[kr], name: "Software: Entwicklung", parentCategory: "software" as const };

  it("nimmt ein freies vierstelliges Konto der Aufwandsklasse", () => {
    expect(ownAccountProblem(ok)).toBeNull();
  });

  it("verlangt genau vier Ziffern", () => {
    for (const account of ["", "499", "49999", "49a9", " 4999", "4,99"]) expect(ownAccountProblem({ ...ok, account }), account).toMatch(/vier Ziffern/);
  });

  it("verlangt die Aufwandsklasse des Kontenrahmens", () => {
    const falsch = kr === "SKR03" ? "8999" : "4999";
    expect(ownAccountProblem({ ...ok, account: falsch })).toMatch(kr === "SKR03" ? /4000 bis 4999/ : /6000 bis 6999/);
  });

  it("lehnt die Nummer eines Systemkontos ab, auch die der Kategorien selbst", () => {
    for (const nummer of reservedAccountNumbers(kr)) {
      if (nummer[0] === (kr === "SKR03" ? "4" : "6")) expect(ownAccountProblem({ ...ok, account: nummer }), nummer).toMatch(/belegt/);
    }
    expect(ownAccountProblem({ ...ok, account: EXPENSE_CATEGORIES.software[kr] })).toMatch(/belegt/);
  });

  it("verlangt einen Namen und eine zulässige Elternkategorie", () => {
    expect(ownAccountProblem({ ...ok, name: "  " })).toMatch(/Name/);
    expect(ownAccountProblem({ ...ok, name: "x".repeat(81) })).toMatch(/Name/);
    // gezählt wie in der Datenbank: Zeichen, nicht UTF-16-Einheiten
    expect(ownAccountProblem({ ...ok, name: "😀".repeat(41) })).toBeNull();
    expect(ownAccountProblem({ ...ok, parentCategory: "anlage" as never })).toMatch(/Elternkategorie/);
    expect(ownAccountProblem({ ...ok, parentCategory: "gibtsnicht" as never })).toMatch(/Elternkategorie/);
  });
});

describe("Systemkonten", () => {
  it("enthalten Konten aus allen Bereichen, getrennt nach Kontenrahmen", () => {
    const skr03 = reservedAccountNumbers("SKR03");
    const skr04 = reservedAccountNumbers("SKR04");
    // Bank, Erlöse, Steuer, Lohn, Privat, Gesellschafter, Anlagen, Körperschaftsteuer-Aufwand
    for (const nummer of ["1200", "8400", "1576", "4320", "1800", "0730", "0490", "4964", "4650"]) expect(skr03.has(nummer), `SKR03 ${nummer}`).toBe(true);
    for (const nummer of ["1800", "4400", "1406", "6837", "6640", "2100", "3510"]) expect(skr04.has(nummer), `SKR04 ${nummer}`).toBe(true);
    // Eine SKR04-Nummer wird im SKR03 nicht gesperrt, wenn sie dort nichts bedeutet
    expect(skr03.has("6837")).toBe(false);
  });
});

describe("Auflösung", () => {
  const eigene = new Map<string, ExpenseCategory>([
    ["4999", "software"],
    ["6999", "bewirtung"],
  ]);

  it("gibt für ein eigenes Konto das Konto seiner Elternkategorie", () => {
    expect(resolveOwnAccount("SKR03", "4999", eigene)).toBe("4964");
    expect(resolveOwnAccount("SKR04", "6999", eigene)).toBe("6640");
  });

  it("lässt jedes andere Konto unverändert", () => {
    expect(resolveOwnAccount("SKR03", "4964", eigene)).toBe("4964");
    expect(resolveOwnAccount("SKR03", "1200", eigene)).toBe("1200");
    expect(resolveOwnAccount("SKR03", "4999", new Map())).toBe("4999");
  });
});

describe.each(KR)("Systemkonten, ausdrücklich aufgezählt (%s, #270)", (kr) => {
  it("sperrt die Konten der Gewerbesteuer-Hinzurechnung: ein eigenes Konto dort nähme ihnen die Hinzurechnung", () => {
    const konten = Object.values(GEWST_HINZURECHNUNG_KONTEN[kr]).flat();
    expect(konten.length).toBeGreaterThan(8);
    for (const nummer of konten) expect(reservedAccountNumbers(kr).has(nummer), nummer).toBe(true);
  });

  it("sperrt jedes Konto, das das Hauptbuch selbst bebucht (Bank, Kasse, Forderungen, Verbindlichkeiten, Steuer, Anlagen)", () => {
    for (const nummer of ledgerManagedAccounts(kr).keys()) expect(reservedAccountNumbers(kr).has(nummer), nummer).toBe(true);
  });
});

describe.each(KR)("Wirkung der Auflösung auf EÜR und E-Bilanz (%s, #270)", (kr) => {
  const eigenes = frei[kr];
  const eigene = new Map<string, ExpenseCategory>([[eigenes, "software"]]);
  const software = EXPENSE_CATEGORIES.software[kr];

  it("ohne Auflösung fiele ein eigenes Konto aus der EÜR; aufgelöst zählt es wie die Kategorie, in EÜR und E-Bilanz", () => {
    expect(euerZuordnung(kr, eigenes)).toBeNull();
    const aufgeloest = resolveOwnAccount(kr, eigenes, eigene);
    expect(aufgeloest).toBe(software);
    expect(euerZuordnung(kr, aufgeloest)).toBe("ausgabe:software");
    expect(euerZuordnung(kr, aufgeloest)).toBe(euerZuordnung(kr, software));
    expect(ebilanzPosition(kr, aufgeloest, 1)).toBe(ebilanzPosition(kr, software, 1));
    expect(ebilanzPosition(kr, software, 1)).not.toBeNull();
  });

  it("eine unbekannte Elternkategorie (entfernt oder umbenannt) bricht nicht ab, das Konto bleibt, wie es ist", () => {
    expect(resolveOwnAccount(kr, eigenes, new Map([[eigenes, "gibtsnicht" as ExpenseCategory]]))).toBe(eigenes);
  });
});

describe.each(KR)("Bereich der Elternkategorie (%s, #270)", (kr) => {
  const klasse = kr === "SKR03" ? "4" : "6";
  const frei = (account: string) => !reservedAccountNumbers(kr).has(account);
  const nummern = Array.from({ length: 1000 }, (_, i) => `${klasse}${String(i).padStart(3, "0")}`).filter(frei);
  const gleich = (a: [string, string | undefined] | null, b: [string, string | undefined] | null) => a !== null && b !== null && a[0] === b[0] && a[1] === b[1];

  it.each(ownAccountParents(kr))(
    "%s: eine freie Nummer im selben Bereich geht, eine in der Aufwandsklasse, aber in einem anderen Bereich, wird abgelehnt",
    (parent) => {
      const bereich = bereichPosten(kr, EXPENSE_CATEGORIES[parent][kr]);
      const passend = nummern.find((n) => gleich(bereichPosten(kr, n), bereich));
      const anders = nummern.find((n) => !gleich(bereichPosten(kr, n), bereich));
      expect(passend, `freie Nummer im Bereich von ${parent}`).toBeDefined();
      expect(ownAccountProblem({ kontenrahmen: kr, account: passend!, name: "Test", parentCategory: parent })).toBeNull();
      expect(anders, `freie Nummer außerhalb des Bereichs von ${parent}`).toBeDefined();
      expect(ownAccountProblem({ kontenrahmen: kr, account: anders!, name: "Test", parentCategory: parent })).toMatch(/Bereich/);
    },
  );

  it("das Beispiel des Maintainers: ein Konto mit Elternkategorie Software im Bereich Personalaufwand wird abgelehnt", () => {
    const personal = nummern.find((n) => bereichPosten(kr, n)?.[0] === "personalaufwand");
    expect(personal).toBeDefined();
    expect(ownAccountProblem({ kontenrahmen: kr, account: personal!, name: "Software", parentCategory: "software" })).toMatch(/Bereich/);
    // und umgekehrt: Berufsgenossenschaft gehört in den Personalaufwand
    expect(ownAccountProblem({ kontenrahmen: kr, account: personal!, name: "BG", parentCategory: "berufsgenossenschaft" })).toBeNull();
  });
});
