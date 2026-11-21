import { type Bundesland, isKapitalgesellschaft, parseBaseRate, parseEuro, type Rechtsform } from "@haben/core";
import type { saveCompany } from "../../server/functions/company.ts";
import type { loadCompany } from "../../server/modules/stammdaten/index.ts";
import { type PrivatanteilTexte, privatanteilWerte } from "../PrivatanteilVorgaben.tsx";
import type { Mahngebuehren } from "./kurzwerte.ts";

type Firma = Awaited<ReturnType<typeof loadCompany>>;
export type FirmaDaten = Parameters<typeof saveCompany>[0]["data"];

/**
 * Die Angaben, die „Speichern“ in den Firmendaten an den Server schickt, aus dem Formular und dem Zustand der Abschnitte.
 * Die Felder zugeklappter Abschnitte stehen im Formular und gehen mit.
 */
export function firmaDaten({
  form,
  company,
  rechtsform,
  skonto,
  fees,
  privatanteile,
}: {
  form: FormData;
  company: Firma;
  rechtsform: Rechtsform;
  skonto: FirmaDaten["skonto"];
  fees: Mahngebuehren;
  privatanteile: PrivatanteilTexte;
}): FirmaDaten {
  const text = (name: string) => String(form.get(name) ?? "");
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  return {
    name: text("name"),
    rechtsform,
    // Ohne Kapitalgesellschaft stehen die Felder nicht im Formular; gespeicherte Angaben bleiben
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
    defaultFormat: (text("defaultFormat") || "zugferd") as "zugferd" | "xrechnung-cii" | "xrechnung-ubl",
    kleinunternehmer: form.get("kleinunternehmer") === "on",
    foundedOn: text("foundedOn") || null,
    ohneVorsteuerabzug: form.get("ohneVorsteuerabzug") === "on",
    tageskurs: form.get("tageskurs") === "on",
    einkunftsart: text("einkunftsart") === "gewerbe" ? "gewerbe" : text("einkunftsart") === "selbstaendig" ? "selbstaendig" : null,
    taetigkeit: text("taetigkeit"),
    dunning: {
      // Geprüft mit baseRateError; leer heißt keine Verzugszinsen
      baseRate: text("dunning-baseRate").trim() ? parseBaseRate(text("dunning-baseRate")) : null,
      fees: {
        "1": parseEuro(fees["1"] || "0") ?? 0,
        "2": parseEuro(fees["2"] || "0") ?? 0,
        "3": parseEuro(fees["3"] || "0") ?? 0,
      },
      deadlineDays: Number(text("dunning-deadlineDays") || 10),
      autoBaseRate: form.get("dunning-autoBaseRate") === "on",
    },
    privateShares: privatanteilWerte(privatanteile, gesellschaft),
  };
}
