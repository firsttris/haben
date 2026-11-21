import { type Bundesland, parseBaseRate, parseEuro, type Rechtsform } from "@haben/core";
import { describe, expect, it } from "vitest";
import { privatanteilWerte } from "../PrivatanteilVorgaben.tsx";
import { firmaDaten } from "./firma-daten.ts";

type Eingabe = Parameters<typeof firmaDaten>[0];

/** Der Aufbau der Angaben, wie ihn CompanyForm vor der Teilung (#1253) in onSubmit hatte; firmaDaten muss dasselbe liefern */
function frueher({ form, company, rechtsform, skonto, fees, privatanteile }: Eingabe) {
  const gesellschaft = rechtsform === "gmbh" || rechtsform === "ug";
  const text = (name: string) => String(form.get(name) ?? "");
  return {
    name: text("name"),
    rechtsform,
    sitz: gesellschaft ? text("sitz") : company.sitz,
    registergericht: gesellschaft ? text("registergericht") : company.registergericht,
    registernummer: gesellschaft ? text("registernummer") : company.registernummer,
    geschaeftsfuehrer: gesellschaft ? text("geschaeftsfuehrer") : company.geschaeftsfuehrer,
    aufsichtsratVorsitz: gesellschaft ? text("aufsichtsratVorsitz") : company.aufsichtsratVorsitz,
    strasse: text("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    email: text("email"),
    steuernummer: text("steuernummer"),
    ustId: text("ustId").toUpperCase().replace(/\s/g, ""),
    finanzamt: text("finanzamt"),
    bundesland: (text("bundesland") || null) as Bundesland | null,
    versteuerung: text("versteuerung") === "soll" ? "soll" : "ist",
    telefon: text("telefon"),
    bank: text("bank"),
    iban: text("iban").toUpperCase().replace(/\s/g, ""),
    bic: text("bic").toUpperCase().replace(/\s/g, ""),
    kontoinhaber: text("kontoinhaber"),
    glaeubigerId: text("glaeubigerId"),
    kontenrahmen: text("kontenrahmen") === "SKR04" ? "SKR04" : "SKR03",
    paymentTermDays: Number(text("paymentTermDays") || 14),
    skonto,
    defaultFormat: text("defaultFormat") || "zugferd",
    kleinunternehmer: form.get("kleinunternehmer") === "on",
    foundedOn: text("foundedOn") || null,
    ohneVorsteuerabzug: form.get("ohneVorsteuerabzug") === "on",
    tageskurs: form.get("tageskurs") === "on",
    einkunftsart: text("einkunftsart") === "gewerbe" ? "gewerbe" : text("einkunftsart") === "selbstaendig" ? "selbstaendig" : null,
    taetigkeit: text("taetigkeit"),
    dunning: {
      baseRate: text("dunning-baseRate").trim() ? parseBaseRate(text("dunning-baseRate")) : null,
      fees: { "1": parseEuro(fees["1"] || "0") ?? 0, "2": parseEuro(fees["2"] || "0") ?? 0, "3": parseEuro(fees["3"] || "0") ?? 0 },
      deadlineDays: Number(text("dunning-deadlineDays") || 10),
      autoBaseRate: form.get("dunning-autoBaseRate") === "on",
    },
    privateShares: privatanteilWerte(privatanteile, gesellschaft),
  };
}

const gespeichert = {
  sitz: "Bremen",
  registergericht: "Amtsgericht Bremen",
  registernummer: "HRB 1",
  geschaeftsfuehrer: "Erika Mustermann",
  aufsichtsratVorsitz: "",
} as unknown as Eingabe["company"];

const felder = {
  name: "Mustermann IT",
  taetigkeit: "Software",
  strasse: "Musterstr. 1",
  plz: "28217",
  ort: "Bremen",
  email: "a@b.de",
  steuernummer: "60/145/12345",
  ustId: "de 123 456 789",
  iban: "de89 3704 0044 0532 0130 00",
  bic: "coba de ff",
  "dunning-baseRate": "2,27",
  "dunning-deadlineDays": "14",
  paymentTermDays: "",
  kontenrahmen: "SKR04",
  versteuerung: "soll",
  einkunftsart: "gewerbe",
  sitz: "Hamburg",
  registergericht: "Amtsgericht Hamburg",
  registernummer: "HRB 2",
  geschaeftsfuehrer: "Max Muster",
  kleinunternehmer: "on",
  tageskurs: "on",
  "dunning-autoBaseRate": "on",
};

function eingabe(rechtsform: Rechtsform, werte: Record<string, string>): Eingabe {
  const form = new FormData();
  for (const [name, wert] of Object.entries(werte)) form.set(name, wert);
  return {
    form,
    company: gespeichert,
    rechtsform,
    skonto: [{ percent: 2, days: 10 }] as unknown as Eingabe["skonto"],
    fees: { "1": "", "2": "5,00", "3": "10" },
    privatanteile: { telefon: "20 %", internet: "" },
  };
}

describe("Angaben der Firmendaten zum Speichern (#1253)", () => {
  it.each([
    ["Einzelunternehmen, alles ausgefüllt", "einzelunternehmen", felder],
    ["Einzelunternehmen, leeres Formular", "einzelunternehmen", {}],
    ["GmbH, alles ausgefüllt", "gmbh", felder],
    ["GmbH, leeres Formular", "gmbh", {}],
  ] as const)("%s: dasselbe wie vor der Teilung", (_, rechtsform, werte) => {
    const e = eingabe(rechtsform, werte);
    expect(firmaDaten(e)).toEqual(frueher(e));
  });

  it("behält im Einzelunternehmen die gespeicherten Angaben der Gesellschaft und nimmt dort keine Privatanteile weg", () => {
    const daten = firmaDaten(eingabe("einzelunternehmen", felder));
    expect(daten).toMatchObject({ sitz: "Bremen", registernummer: "HRB 1", privateShares: { telefon: 20 } });
    expect(firmaDaten(eingabe("gmbh", felder))).toMatchObject({ sitz: "Hamburg", privateShares: {} });
  });
});
