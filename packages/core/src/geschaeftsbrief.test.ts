import { describe, expect, it } from "vitest";
import { hasWrittenOutFirstName, legalInfo, legalInfoGaps, managingDirectorList, nameShowsLegalForm, type LegalInfoSource } from "./geschaeftsbrief.ts";

const gmbh: LegalInfoSource = {
  name: "Muster Software GmbH",
  rechtsform: "gmbh",
  sitz: "",
  ort: "Bremen",
  registergericht: "Amtsgericht Bremen",
  registernummer: "HRB 12345 HB",
  geschaeftsfuehrer: "Erika Mustermann\n\n  Dr. Max  Muster ",
  aufsichtsratVorsitz: "",
};

describe("Pflichtangaben auf Geschäftsbriefen (§ 35a GmbHG)", () => {
  it("liest alle Geschäftsführer, einen je Zeile", () => {
    expect(managingDirectorList(gmbh.geschaeftsfuehrer)).toEqual(["Erika Mustermann", "Dr. Max Muster"]);
    expect(managingDirectorList("")).toEqual([]);
  });

  it("nimmt den Ort der Anschrift, wenn kein Sitz eingetragen ist", () => {
    expect(legalInfo(gmbh)).toEqual({
      seat: "Bremen",
      registerCourt: "Amtsgericht Bremen",
      registerNumber: "HRB 12345 HB",
      managingDirectors: ["Erika Mustermann", "Dr. Max Muster"],
    });
    expect(legalInfo({ ...gmbh, sitz: "Bremerhaven" })?.seat).toBe("Bremerhaven");
  });

  it("nennt die Rechtsform nur, wenn der Firmenname sie nicht enthält (§ 4, § 5a Abs. 1 GmbHG)", () => {
    expect(nameShowsLegalForm("Muster Gesellschaft mit beschränkter Haftung", "gmbh")).toBe(true);
    expect(nameShowsLegalForm("Muster gGmbH", "gmbh")).toBe(true);
    expect(nameShowsLegalForm("Muster UG (haftungsbeschränkt)", "ug")).toBe(true);
    expect(nameShowsLegalForm("Muster Unternehmergesellschaft (haftungsbeschränkt)", "ug")).toBe(true);
    // „UG“ allein ist keine zulässige Bezeichnung
    expect(nameShowsLegalForm("Muster UG", "ug")).toBe(false);
    expect(legalInfo({ ...gmbh, name: "Muster Software" })?.legalForm).toBe("GmbH");
    expect(legalInfo({ ...gmbh, name: "Muster UG", rechtsform: "ug" })?.legalForm).toBe("UG (haftungsbeschränkt)");
  });

  it("verlangt Familienname und einen ausgeschriebenen Vornamen", () => {
    expect(hasWrittenOutFirstName("Erika Mustermann")).toBe(true);
    expect(hasWrittenOutFirstName("Dr. Erika Mustermann")).toBe(true);
    expect(hasWrittenOutFirstName("E. Mustermann")).toBe(false);
    expect(hasWrittenOutFirstName("Mustermann")).toBe(false);
  });

  it("meldet, was fehlt", () => {
    expect(legalInfoGaps(gmbh)).toEqual([]);
    expect(legalInfoGaps({ ...gmbh, registergericht: "", registernummer: "", geschaeftsfuehrer: "" })).toEqual([
      "Registergericht fehlt",
      "Registernummer fehlt",
      "Geschäftsführer fehlt",
    ]);
    expect(legalInfoGaps({ ...gmbh, geschaeftsfuehrer: "E. Mustermann", aufsichtsratVorsitz: "Schulze" })).toEqual([
      "„E. Mustermann“: Familienname und ausgeschriebener Vorname",
      "„Schulze“: Familienname und ausgeschriebener Vorname",
    ]);
  });

  it("nimmt den Vorsitzenden des Aufsichtsrats auf, wenn es einen gibt", () => {
    expect(legalInfo({ ...gmbh, aufsichtsratVorsitz: " Hans Schulze " })?.supervisoryBoardChair).toBe("Hans Schulze");
  });

  it("lässt das Einzelunternehmen unverändert", () => {
    const einzel = { ...gmbh, rechtsform: "einzelunternehmen" as const, registergericht: "", registernummer: "", geschaeftsfuehrer: "" };
    expect(legalInfo(einzel)).toBeUndefined();
    expect(legalInfoGaps(einzel)).toEqual([]);
  });
});
