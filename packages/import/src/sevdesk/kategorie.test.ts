import { EXPENSE_CATEGORIES, legacyNeutralKind } from "@haben/core";
import { describe, expect, it } from "vitest";
import konten from "../../test-fixtures/sevdesk/buchhaltung-1.0/accounting-type.json" with { type: "json" };
import { sevAccountCategory } from "./kategorie.ts";

/* Kategorie einer Position aus dem Kontostamm von sevDesk (#472); Nummern aus den DATEV-Kontenrahmen, erfunden kombiniert */

const neutral = (name: string, rechtsform: "gmbh" | "einzelunternehmen" = "gmbh") =>
  legacyNeutralKind({ privat: false, categories: [name], tax: 0 }, rechtsform);

describe("sevAccountCategory", () => {
  it("ordnet Aufwandskonten der Ausgabenkategorie mit derselben Nummer zu, nach SKR03 und SKR04", () => {
    expect(sevAccountCategory([{ skr03: "4530", skr04: "6530" }])).toEqual({ art: "ausgabe", kategorie: "kfzBetrieb", name: "Kfz: Laden, Tanken, Wartung" });
    expect(sevAccountCategory([{ skr03: "4964", skr04: null }])).toMatchObject({ kategorie: "software" });
    expect(sevAccountCategory([{ skr03: "", skr04: "6837" }])).toMatchObject({ kategorie: "software" });
  });

  it("liest die Antworten aus der Testdatei: Dienstleister wird Fremdleistung, das Erlöskonto Erlöse", () => {
    const [dienstleister, erloes] = konten;
    expect(sevAccountCategory([dienstleister!])).toMatchObject({ art: "ausgabe", kategorie: "fremdleistung" });
    expect(sevAccountCategory([erloes!])).toEqual({ art: "erloes", name: "Erlöse" });
  });

  it("nennt neutrale Konten mit dem Namen des DATEV-Kontos, den legacyNeutralKind bei GmbH einordnet", () => {
    const art = (skr03: string, skr04: string) => neutral(sevAccountCategory([{ skr03, skr04 }])!.name);
    expect(art("0730", "3510")).toBe("gesellschafter");
    expect(art("1800", "2100")).toBe("gesellschafter");
    expect(art("1810", "2150")).toBe("gesellschafter");
    expect(art("0800", "2900")).toBe("kapital");
    expect(art("0640", "3160")).toBe("kapital");
    expect(art("2200", "7600")).toBe("ertragsteuern");
    expect(art("2208", "7608")).toBe("ertragsteuern");
    expect(art("4320", "7610")).toBe("ertragsteuern");
    expect(neutral(sevAccountCategory([{ skr03: "1800", skr04: "2100" }])!.name, "einzelunternehmen")).toBeNull();
  });

  it("macht keine Ausgabenkategorie neutral", () => {
    for (const { label } of Object.values(EXPENSE_CATEGORIES)) expect(neutral(label), label).toBeNull();
  });

  it("lässt Anlagegut und Einfuhrumsatzsteuer aus, sie brauchen Anlagenverzeichnis bzw. Bescheid", () => {
    expect(sevAccountCategory([{ skr03: "0490", skr04: "0690" }])).toBeNull();
    expect(sevAccountCategory([{ skr03: "1588", skr04: "1433" }])).toBeNull();
  });

  it("bleibt unklar ohne Nummer, bei unbekannter Nummer und bei Widerspruch", () => {
    expect(sevAccountCategory([])).toBeNull();
    expect(sevAccountCategory([{ skr03: null, skr04: "" }])).toBeNull();
    expect(sevAccountCategory([{ skr03: "4999", skr04: "6999" }])).toBeNull();
    expect(sevAccountCategory([{ skr03: "A100", skr04: "6837" }])).toBeNull();
    // SKR03 2150 Kursaufwand, SKR04 4840 Kursertrag
    expect(sevAccountCategory([{ skr03: "2150", skr04: "4840" }])).toBeNull();
    expect(sevAccountCategory([{ skr03: "4964", skr04: "6530" }])).toBeNull();
    // eine erkannte und eine nicht erkannte Nummer
    expect(sevAccountCategory([{ skr03: "4964", skr04: "6999" }])).toBeNull();
  });

  it("verlangt bei mehreren Antworten zum selben Konto dasselbe Ergebnis", () => {
    expect(sevAccountCategory([{ skr03: "4964" }, { skr04: "6837" }])).toMatchObject({ kategorie: "software" });
    expect(sevAccountCategory([{ skr03: "4964" }, { skr03: "4530" }])).toBeNull();
    expect(sevAccountCategory([{ skr03: "4964" }, { skr03: null, skr04: null }])).toBeNull();
  });

  it("ergänzt kurze Nummern mit Nullen", () => {
    expect(sevAccountCategory([{ skr03: "800", skr04: "2900" }])).toMatchObject({ art: "neutral", name: "Gezeichnetes Kapital" });
  });
});
