import { expect, it } from "vitest";
import { fintsClient, type FintsGespeichert } from "./sitzung.ts";

const PRODUKT = { id: "TESTPRODUKT0123456789ABCD", version: "0.11" };
const ZUGANG = { url: "https://banking-rl7.s-fints-pt-rl.de/fints30", blz: "37050198", benutzer: "testperson", pin: "test-pin" };

function gespeichert(): FintsGespeichert {
  return {
    tanVerfahren: 923,
    tanMedium: "Alle Geräte",
    bankingInformation: {
      systemId: "TEST-SYSTEM",
      bankMessages: [],
      bpd: {
        version: 1,
        countryCode: 280,
        bankId: ZUGANG.blz,
        bankName: "Testbank",
        url: ZUGANG.url,
        maxTransactionsPerMessage: 1,
        supportedLanguages: [],
        supportedHbciVersions: [300],
        availableTanMethodIds: [923],
        allowedTransactions: [],
        supportedTanMethods: [
          { id: 923, name: "pushTAN 2.0", version: 7, isDecoupled: true, activeTanMediaCount: 1, activeTanMedia: [], tanMediaRequirement: 2 },
        ],
      },
    },
  };
}

it.each<[string, (daten: FintsGespeichert) => void]>([
  ["andere Bankleitzahl", (d) => (d.bankingInformation.bpd!.bankId = "12030000")],
  ["anderer Host", (d) => (d.bankingInformation.bpd!.url = "https://andere-bank.example/fints")],
  ["HTTP", (d) => (d.bankingInformation.bpd!.url = ZUGANG.url.replace("https:", "http:"))],
  ["anderes Medium", (d) => (d.tanMedium = "Mein Handy")],
  ["nicht entkoppelt", (d) => (d.bankingInformation.bpd!.supportedTanMethods[0]!.isDecoupled = false)],
  ["Medium nicht zwingend", (d) => (d.bankingInformation.bpd!.supportedTanMethods[0]!.tanMediaRequirement = 0)],
  [
    "anderes Verfahren",
    (d) => {
      d.tanVerfahren = 912;
      d.bankingInformation.bpd!.availableTanMethodIds = [912];
      d.bankingInformation.bpd!.supportedTanMethods[0]!.id = 912;
    },
  ],
])("prüft ein gespeichertes Medium weiter gegen die Bankliste: %s", (_fall, aendern) => {
  const daten = gespeichert();
  aendern(daten);
  expect(() => fintsClient(PRODUKT, ZUGANG, daten)).toThrow(/not found in the active TAN media list/);
});

it("erhält die Bankliste beim erneuten Laden ohne doppelte Einträge", () => {
  const daten = gespeichert();
  daten.bankingInformation.bpd!.supportedTanMethods[0]!.activeTanMedia = ["Mein Handy", "Alle Geräte"];
  fintsClient(PRODUKT, ZUGANG, daten);
  fintsClient(PRODUKT, ZUGANG, daten);
  expect(daten.bankingInformation.bpd!.supportedTanMethods[0]!.activeTanMedia).toEqual(["Mein Handy", "Alle Geräte"]);
});
