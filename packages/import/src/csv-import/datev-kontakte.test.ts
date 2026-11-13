import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DatevGpRow } from "../datev-stammdaten.ts";
import { parseDatevStammdaten } from "../datev-stammdaten.ts";
import { type DatevStockContact, datevContactCandidates, planDatevContacts } from "./datev-kontakte.ts";

const gp = (line: number, values: Partial<DatevGpRow>): DatevGpRow => ({
  line,
  konto: String(values.nr ?? ""),
  rolle: values.nr == null ? null : values.nr < 70000 ? "debitor" : "kreditor",
  nr: null,
  name: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "DE",
  email: "",
  telefon: "",
  ustId: "",
  iban: "",
  kundennummer: "",
  steuernummer: "",
  errors: [],
  ...values,
});

const stock = (values: Partial<DatevStockContact>): DatevStockContact => ({
  id: "c1",
  name: "Bestand",
  kundennummer: null,
  ustId: "",
  debitorNr: null,
  kreditorNr: null,
  debitorFest: false,
  kreditorFest: false,
  archived: false,
  ...values,
});

const plan = (rows: DatevGpRow[], contacts: DatevStockContact[] = []) =>
  planDatevContacts(datevContactCandidates(rows), contacts).map(({ lines, status, message }) => [lines, status, message]);

describe("datevContactCandidates", () => {
  it("macht aus einer Zeile einen Kontakt; die Rolle kommt aus dem Kontenbereich, die Kundennummer nur vom Debitor", () => {
    const [kunde, lieferant] = datevContactCandidates([
      gp(3, { nr: 10001, name: "Müller GmbH", kundennummer: "K-1", ustId: "DE136695976", ort: "Köln" }),
      gp(4, { nr: 70001, name: "Papier AG", kundennummer: "99" }),
    ]);
    expect(kunde).toMatchObject({
      line: 3,
      lines: [3],
      title: "Müller GmbH",
      errors: [],
      value: {
        name: "Müller GmbH",
        kundennummer: "K-1",
        lieferantennummer: "",
        ort: "Köln",
        isCustomer: true,
        isSupplier: false,
        debitorNr: 10001,
        kreditorNr: null,
      },
    });
    // Was „Kundennummer“ am Kreditor meint (eigene Nummer beim Lieferanten?), ist offen; Haben lässt sie weg
    expect(lieferant!.value).toMatchObject({ kundennummer: "", isCustomer: false, isSupplier: true, debitorNr: null, kreditorNr: 70001 });
  });

  it("führt Debitor und Kreditor mit gleicher USt-IdNr. oder gleicher Steuernummer zu einem Kontakt mit beiden Rollen zusammen", () => {
    const rows = datevContactCandidates([
      gp(3, { nr: 10001, name: "Müller GmbH", ustId: "DE136695976", strasse: "Hauptstraße 5" }),
      gp(4, { nr: 10002, name: "Schulz KG", steuernummer: "214/5678/9012" }),
      gp(5, { nr: 70001, name: "Müller GmbH Einkauf", ustId: "DE136695976", iban: "DE89370400440532013000" }),
      gp(6, { nr: 70002, name: "Schulz KG", steuernummer: "21456789012" }),
    ]);
    expect(rows.map((r) => [r.lines, r.value?.debitorNr, r.value?.kreditorNr, r.value?.isCustomer, r.value?.isSupplier, r.hints])).toEqual([
      [[3, 5], 10001, 70001, true, true, ["Debitor 10001 und Kreditor 70001: gleiche USt-IdNr. DE136695976", "Name in Zeile 5: „Müller GmbH Einkauf“"]],
      [[4, 6], 10002, 70002, true, true, ["Debitor 10002 und Kreditor 70002: gleiche Steuernummer"]],
    ]);
    // Leere Felder des Debitors füllt der Kreditor
    expect(rows[0]!.value).toMatchObject({ name: "Müller GmbH", strasse: "Hauptstraße 5", iban: "DE89370400440532013000" });
  });

  it("führt bei gleichem Namen allein nicht zusammen (#327): eigener Kontakt mit Hinweis", () => {
    const rows = datevContactCandidates([gp(3, { nr: 10001, name: "Müller GmbH" }), gp(4, { nr: 70001, name: "müller gmbh" })]);
    expect(rows.map((r) => [r.lines, r.value?.debitorNr ?? r.value?.kreditorNr, r.hints])).toEqual([
      [[3], 10001, []],
      [[4], 70001, ["Gleicher Name wie Zeile 3; ohne gleiche USt-IdNr. oder Steuernummer ein eigener Kontakt"]],
    ]);
  });

  it("zählt ein Personenkonto, das weiter oben schon steht, als Dublette und lässt fehlerhafte Zeilen nicht zusammenführen", () => {
    const rows = datevContactCandidates([
      gp(3, { nr: 10001, name: "A" }),
      gp(4, { nr: 10001, name: "A" }),
      gp(5, { nr: 70001, name: "A", ustId: "DE136695976", errors: ["IBAN: ungültig"] }),
      gp(6, { nr: 10003, name: "B", ustId: "DE136695976" }),
    ]);
    expect(rows.map((r) => [r.lines, r.value === null, r.errors, r.duplicateOf])).toEqual([
      [[3], false, [], null],
      [[4], true, [], "Wie Zeile 3 (Debitor 10001)"],
      [[5], true, ["IBAN: ungültig"], null],
      [[6], false, [], null],
    ]);
  });
});

describe("planDatevContacts", () => {
  it("legt neue Partner an, mit Hinweis bei gleichem Namen wie ein Kontakt in Haben", () => {
    expect(plan([gp(3, { nr: 10001, name: "Müller GmbH" }), gp(4, { nr: 70001, name: "Papier AG" })], [stock({ name: "papier ag" })])).toEqual([
      [[3], "neu", null],
      [[4], "neu", "Gleicher Name wie „papier ag“ in Haben; eigener Kontakt"],
    ]);
  });

  it("ändert beim zweiten Import nichts: das Personenkonto ist der Schlüssel, auch bei geändertem Namen", () => {
    const contacts = [stock({ id: "a", name: "Müller GmbH (alt)", debitorNr: 10001, kreditorNr: 70001, ustId: "DE136695976" })];
    expect(
      plan([gp(3, { nr: 10001, name: "Müller GmbH", ustId: "DE136695976" }), gp(4, { nr: 70001, name: "Müller", ustId: "DE136695976" })], contacts),
    ).toEqual([[[3, 4], "dublette", "Gibt es schon („Müller GmbH (alt)“, Debitor 10001 und Kreditor 70001)"]]);
  });

  it("macht eine Nummer, die an einem anderen Kontakt hängt, zur Fehlerzeile", () => {
    const contacts = [
      stock({ id: "a", name: "Anna", debitorNr: 10001 }),
      stock({ id: "b", name: "Bert", kreditorNr: 70001 }),
      stock({ id: "c", name: "Clara", debitorNr: 10002, ustId: "DE111111125" }),
    ];
    expect(
      plan(
        [
          gp(3, { nr: 10001, name: "Müller", ustId: "DE136695976" }),
          gp(4, { nr: 70001, name: "Müller", ustId: "DE136695976" }),
          gp(5, { nr: 10002, name: "Clara", ustId: "DE136695976" }),
        ],
        contacts,
      ),
    ).toEqual([
      [[3, 4], "fehler", "Debitor 10001 hat schon „Anna“, Kreditor 70001 „Bert“"],
      [[5], "fehler", "Debitor 10002 hat schon „Clara“ mit anderer USt-IdNr. (DE111111125)"],
    ]);
  });

  it("schlägt einem Kontakt ohne Personenkonto mit gleicher USt-IdNr. oder Kundennummer die Nummer vor, nur zur Bestätigung", () => {
    const contacts = [
      stock({ id: "a", name: "Müller GmbH", ustId: "de 136695976" }),
      stock({ id: "b", name: "Schulz KG", kundennummer: "K-2", archived: true }),
    ];
    const planned = planDatevContacts(
      datevContactCandidates([gp(3, { nr: 10001, name: "Müller", ustId: "DE136695976" }), gp(4, { nr: 10002, name: "Schulz", kundennummer: "K-2" })]),
      contacts,
    );
    expect(planned).toEqual([
      expect.objectContaining({
        status: "zuordnen",
        message: "Debitor 10001 an „Müller GmbH“ vergeben (gleiche USt-IdNr.)",
        assign: { contactId: "a", debitorNr: 10001, kreditorNr: null },
      }),
      expect.objectContaining({
        status: "zuordnen",
        message: "Debitor 10002 an „Schulz KG“ (archiviert) vergeben (gleiche Kundennummer)",
        assign: { contactId: "b", debitorNr: 10002, kreditorNr: null },
      }),
    ]);
  });

  it("ergänzt die zweite Rolle an einem Kontakt, der die erste schon trägt, nur zur Bestätigung", () => {
    const contacts = [stock({ id: "a", name: "Müller GmbH", debitorNr: 10001 })];
    const planned = planDatevContacts(
      datevContactCandidates([gp(3, { nr: 10001, name: "Müller", ustId: "DE136695976" }), gp(4, { nr: 70001, name: "Müller", ustId: "DE136695976" })]),
      contacts,
    );
    expect(planned).toEqual([
      expect.objectContaining({
        lines: [3, 4],
        status: "zuordnen",
        message: "Kreditor 70001 an „Müller GmbH“ vergeben (hat Debitor 10001); Debitor 10001 und Kreditor 70001: gleiche USt-IdNr. DE136695976",
        assign: { contactId: "a", debitorNr: null, kreditorNr: 70001 },
      }),
    ]);
  });

  it("lässt eine schon exportierte Nummer fest: kein Vorschlag, sondern Fehlerzeile", () => {
    const contacts = [
      stock({ id: "a", name: "Müller GmbH", ustId: "DE136695976", debitorNr: 10005, debitorFest: true }),
      stock({ id: "b", name: "Frei", ustId: "DE111111125", debitorNr: 10006 }),
    ];
    expect(plan([gp(3, { nr: 10001, name: "Müller", ustId: "DE136695976" }), gp(4, { nr: 10002, name: "Frei", ustId: "DE111111125" })], contacts)).toEqual([
      [[3], "fehler", "„Müller GmbH“ mit gleicher USt-IdNr. hat schon Debitor 10005; er steht in einem DATEV-Export und bleibt fest"],
      [[4], "fehler", "„Frei“ mit gleicher USt-IdNr. hat schon Debitor 10006; ändere ihn dort, wenn die Datei recht hat"],
    ]);
  });

  it("schlägt keinen Kontakt vor, wenn die USt-IdNr. mehrere haben oder eine Zeile weiter oben ihn schon bekommt", () => {
    const contacts = [
      stock({ id: "a", name: "A1", ustId: "DE136695976" }),
      stock({ id: "b", name: "A2", ustId: "DE136695976" }),
      stock({ id: "c", name: "C", ustId: "DE111111125" }),
    ];
    expect(
      plan(
        [
          gp(3, { nr: 10001, name: "A", ustId: "DE136695976" }),
          gp(4, { nr: 10002, name: "C", ustId: "DE111111125" }),
          gp(5, { nr: 10003, name: "C", ustId: "DE111111125" }),
        ],
        contacts,
      ),
    ).toEqual([
      [[3], "fehler", "USt-IdNr. bzw. Kundennummer passen zu mehreren Kontakten („A1“, „A2“); trage die Nummer dort von Hand ein"],
      [[4], "zuordnen", "Debitor 10002 an „C“ vergeben (gleiche USt-IdNr.)"],
      [[5], "fehler", "„C“ bekommt schon die Nummer aus Zeile 4; trage diese von Hand ein"],
    ]);
  });

  it("übernimmt Fehler und Dubletten der Datei", () => {
    expect(plan([gp(3, { nr: 10001, name: "A" }), gp(4, { nr: 10001, name: "A" }), gp(5, { name: "B", errors: ["Konto fehlt"] })])).toEqual([
      [[3], "neu", null],
      [[4], "dublette", "Wie Zeile 3 (Debitor 10001)"],
      [[5], "fehler", "Konto fehlt"],
    ]);
  });
});

describe("GP-Stamm aus sevDesk bis zum Plan", () => {
  it("Buchhaltung 2.0: zwei Kreditoren mit gleichem (anonymisiertem) Namen werden zwei Kontakte", () => {
    const parsed = parseDatevStammdaten(
      new Uint8Array(readFileSync(new URL("../../test-fixtures/sevdesk/buchhaltung-2.0/extf-gp-stamm.csv", import.meta.url))),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(plan(parsed.rows)).toEqual([
      [[3], "neu", null],
      [[4], "neu", "Gleicher Name wie Zeile 3; ohne gleiche USt-IdNr. oder Steuernummer ein eigener Kontakt"],
    ]);
  });
});
