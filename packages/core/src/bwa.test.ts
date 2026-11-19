import { describe, expect, it } from "vitest";
import { abweichung, type BwaEuerPosten, FORM43_ZEILEN, form43, form43Anteile, form43KostenartZeile, form43Zeile, type Form43Zeile } from "./bwa.ts";
import { bwaZeitraum } from "./bwa-zeitraum.ts";
import { kostenartOf } from "./bwa-kostenart.ts";
import { euerErgebnis, type EuerLineKey } from "./euer.ts";
import { postenOf } from "./hgb.ts";
import { euerZuordnung } from "./journal-euer.ts";
import { ACCOUNT_NAMES } from "./kontenplan.ts";
import { PAUSCHALE_KONTEN, type PauschaleArt } from "./pauschalen.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";

const FESTE: EuerLineKey[] = [
  "einnahmenKleinunternehmer",
  "einnahmenSteuerpflichtig",
  "einnahmenSteuerfrei",
  "privateKfz",
  "sachentnahmen",
  "ustEntnahmen",
  "vereinnahmteUst",
  "erstatteteUst",
  "kursgewinne",
  "kursverluste",
  "personal",
  "steuerNebenleistungen",
  "schuldzinsenAnlage",
  "schuldzinsen",
  "afa",
  "gwg",
  "sammelposten",
  "restbuchwert",
  "vorsteuer",
  "gezahlteUst",
];
/** Alle Zeilen der EÜR, die das Journal liefern kann; Anlage und Einfuhrumsatzsteuer sind keine Ausgabe (euerZuordnung) */
const ALLE: EuerLineKey[] = [
  ...FESTE,
  ...(Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]).filter((k) => k !== "anlage" && k !== "einfuhrumsatzsteuer").map((k) => `ausgabe:${k}` as const),
  ...(Object.keys(PAUSCHALE_KONTEN) as PauschaleArt[]).map((k) => `pauschale:${k}` as const),
];

const quelle = { buchungId: "b", sourceType: "allocation", sourceId: "s", rechnungId: null, belegId: null };
const posten = (datum: string, zeilen: BwaEuerPosten["zeilen"], kr: Kontenrahmen = "SKR03", extra: Partial<BwaEuerPosten> = {}): BwaEuerPosten => ({
  datum,
  kontenrahmen: kr,
  zeilen,
  bewirtungNichtAbziehbar: 0,
  gewerbesteuerNichtAbziehbar: 0,
  quelle,
  ...extra,
});
const JAHR = bwaZeitraum("jahr", 2027);

describe("Einnahmen-Ausgaben-BWA (DATEV-Form 43)", () => {
  it("jede Zeile der EÜR steht in SKR03 und SKR04 in derselben Zeile der BWA", () => {
    for (const key of ALLE) expect(form43Zeile("SKR04", key), key).toBe(form43Zeile("SKR03", key));
  });

  const ERWARTET: [EuerLineKey, Form43Zeile][] = [
    ["einnahmenSteuerpflichtig", "erloese"],
    ["privateKfz", "sonstigeErloese"],
    ["vereinnahmteUst", "umsatzsteuer"],
    ["erstatteteUst", "ustErstattung"],
    ["ausgabe:wareneinkauf", "material"],
    ["ausgabe:fremdleistung", "fremdleistungen"],
    ["ausgabe:berufsgenossenschaft", "personal"],
    ["ausgabe:miete", "raum"],
    ["pauschale:homeoffice", "raum"],
    ["ausgabe:versicherung", "steuernVersicherungenBeitraege"],
    ["ausgabe:kfzSteuer", "steuernVersicherungenBeitraege"],
    ["ausgabe:kfzBetrieb", "kfz"],
    ["ausgabe:bewirtung", "werbeReise"],
    ["pauschale:verpflegung", "werbeReise"],
    ["ausgabe:reparatur", "instandhaltung"],
    ["ausgabe:hardware", "abschreibungen"],
    ["afa", "abschreibungen"],
    ["ausgabe:software", "verschiedeneKosten"],
    ["restbuchwert", "buchwertAnlagenabgang"],
    ["schuldzinsen", "sonstigeAufwendungen"],
    ["vorsteuer", "vorsteuer"],
    ["gezahlteUst", "ustZahlung"],
  ];
  it.each(ERWARTET)("%s → %s", (key, zeile) => {
    expect(form43Zeile("SKR03", key)).toBe(zeile);
  });

  it("Ergebnis plus Überleitung ist der Gewinn der EÜR, für jede Zeile der EÜR", () => {
    // Je Zeile ein anderer Betrag, damit eine falsch zugeordnete Zeile auffällt
    const zeilen = Object.fromEntries(ALLE.map((key, i) => [key, (i + 1) * 1_001])) as Record<EuerLineKey, number>;
    for (const kr of ["SKR03", "SKR04"] as const) {
      const w = form43(form43Anteile(posten("2027-05-01", zeilen, kr, { bewirtungNichtAbziehbar: 3_000, gewerbesteuerNichtAbziehbar: 500 })), JAHR);
      const euer = euerErgebnis(2027, new Map(Object.entries(zeilen) as [EuerLineKey, number][]), { einnahmen: [], ausgaben: [] }, 3_000, 500);
      expect(w.gewinnEuer, kr).toBe(euer.gewinn);
      expect(w.nichtAbziehbar).toBe(3_500);
      expect(w.ergebnis).toBe(euer.gewinn - 3_500);
    }
  });

  it("die Bewirtung steht voll bei den Kosten, 30 % davon in der Überleitung", () => {
    const w = form43(form43Anteile(posten("2027-02-01", { "ausgabe:bewirtung": 7_000 }, "SKR03", { bewirtungNichtAbziehbar: 3_000 })), JAHR);
    expect(w.werbeReise).toBe(10_000);
    expect(w.summeKosten).toBe(10_000);
    expect(w.ergebnis).toBe(-10_000);
    expect(w.nichtAbziehbar).toBe(3_000);
    expect(w.gewinnEuer).toBe(-7_000);
  });

  it("zählt nur Posten im Zeitraum, Grenzen eingeschlossen", () => {
    const anteile = [
      posten("2027-02-28", { einnahmenSteuerpflichtig: 100 }),
      posten("2027-03-01", { einnahmenSteuerpflichtig: 200 }),
      posten("2027-05-15", { einnahmenSteuerpflichtig: 400 }),
      posten("2027-05-16", { einnahmenSteuerpflichtig: 800 }),
    ].flatMap(form43Anteile);
    expect(form43(anteile, { von: "2027-03-01", bis: "2027-05-15" }).erloese).toBe(600);
  });

  it("Summen: Erlöse, Einnahmen, Kosten, Ausgaben", () => {
    const w = form43(
      form43Anteile(
        posten("2027-04-01", {
          einnahmenSteuerpflichtig: 100_000,
          kursgewinne: 1_000,
          vereinnahmteUst: 19_000,
          "ausgabe:miete": 20_000,
          restbuchwert: 5_000,
          vorsteuer: 3_800,
          gezahlteUst: 10_000,
        }),
      ),
      JAHR,
    );
    expect(w.summeErloese).toBe(101_000);
    expect(w.summeEinnahmen).toBe(120_000);
    expect(w.summeKosten).toBe(20_000);
    expect(w.summeAusgaben).toBe(38_800);
    expect(w.ergebnis).toBe(81_200);
  });
});

describe("Form 43 bleibt für Kategorien und Pauschalen, wie sie vor der Form 01 war", () => {
  // Stand vor den Kostenarten der Form 01 (neutral, Zinsen, Steuern vom Einkommen und Ertrag), in SKR03 und SKR04 gleich
  const VORHER: Record<string, Form43Zeile> = {
    "ausgabe:software": "verschiedeneKosten",
    "ausgabe:edv": "instandhaltung",
    "ausgabe:reparatur": "instandhaltung",
    "ausgabe:miete": "raum",
    "ausgabe:hardware": "abschreibungen",
    "ausgabe:telefon": "verschiedeneKosten",
    "ausgabe:internet": "verschiedeneKosten",
    "ausgabe:buero": "verschiedeneKosten",
    "ausgabe:betriebsbedarf": "verschiedeneKosten",
    "ausgabe:literatur": "verschiedeneKosten",
    "ausgabe:fortbildung": "verschiedeneKosten",
    "ausgabe:fahrtkosten": "werbeReise",
    "ausgabe:uebernachtung": "werbeReise",
    "ausgabe:porto": "verschiedeneKosten",
    "ausgabe:werbung": "werbeReise",
    "ausgabe:bewirtung": "werbeReise",
    "ausgabe:geschenke": "werbeReise",
    "ausgabe:beratung": "verschiedeneKosten",
    "ausgabe:buchfuehrung": "verschiedeneKosten",
    "ausgabe:wareneinkauf": "material",
    "ausgabe:fremdleistung": "fremdleistungen",
    "ausgabe:geldverkehr": "verschiedeneKosten",
    "ausgabe:kfzBetrieb": "kfz",
    "ausgabe:kfzVersicherung": "kfz",
    "ausgabe:kfzSteuer": "steuernVersicherungenBeitraege",
    "ausgabe:kfzReparatur": "kfz",
    "ausgabe:kfzLeasing": "kfz",
    "ausgabe:kfzSonstige": "kfz",
    "ausgabe:versicherung": "steuernVersicherungenBeitraege",
    "ausgabe:beitraege": "steuernVersicherungenBeitraege",
    "ausgabe:berufsgenossenschaft": "personal",
    "ausgabe:versorgungskassen": "personal",
    "ausgabe:sonstiges": "verschiedeneKosten",
    "ausgabe:anlage": "verschiedeneKosten",
    "ausgabe:einfuhrumsatzsteuer": "verschiedeneKosten",
    "pauschale:homeoffice": "raum",
    "pauschale:fahrt": "werbeReise",
    "pauschale:verpflegung": "werbeReise",
    "pauschale:entfernung": "werbeReise",
  };

  it("jede Kategorie und Pauschale", () => {
    const keys = [
      ...(Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]).map((k) => `ausgabe:${k}` as const),
      ...(Object.keys(PAUSCHALE_KONTEN) as PauschaleArt[]).map((k) => `pauschale:${k}` as const),
    ];
    expect(keys.sort()).toEqual(Object.keys(VORHER).sort());
    for (const kr of ["SKR03", "SKR04"] as const) for (const key of keys) expect(form43Zeile(kr, key), `${kr} ${key}`).toBe(VORHER[key]);
  });

  const NEU: [Kontenrahmen, string, Form43Zeile][] = [
    ["SKR03", "2400", "sonstigeAufwendungen"],
    ["SKR04", "6880", "sonstigeAufwendungen"],
    ["SKR03", "2100", "sonstigeAufwendungen"],
    ["SKR04", "7100", "sonstigeErloese"],
    ["SKR03", "2660", "sonstigeErloese"],
    ["SKR03", "8970", "sonstigeErloese"],
    ["SKR04", "7600", "steuernVersicherungenBeitraege"],
    ["SKR03", "4320", "steuernVersicherungenBeitraege"],
    ["SKR03", "2890", "verschiedeneKosten"],
  ];
  it.each(NEU)("die neuen Kostenarten: %s %s → %s", (kr, konto, zeile) => {
    expect(form43KostenartZeile(kostenartOf(kr, konto)!)).toBe(zeile);
  });
});

describe("Jedes Konto aus kontenplan.ts in genau einer Zeile", () => {
  const ZEILEN = new Set<string>(FORM43_ZEILEN);
  /** Alle Konten, die Haben kennt: benannte Konten, Systemkonten und die Konten der Kategorien */
  const konten = (kr: Kontenrahmen) => {
    const flach = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flach) : []);
    return [...new Set([...Object.keys(ACCOUNT_NAMES[kr]), ...flach(ACCOUNTS[kr]), ...Object.values(EXPENSE_CATEGORIES).map((c) => c[kr])])].filter((k) =>
      /^\d{4}$/.test(k),
    );
  };

  it.each(["SKR03", "SKR04"] as const)("%s: ein Konto, das in der EÜR wirkt, steht in genau einer Zeile der BWA", (kr) => {
    for (const konto of konten(kr)) {
      const zuordnung = euerZuordnung(kr, konto);
      if (zuordnung === null) continue;
      // Zahlungen an das bzw. Erstattungen vom Finanzamt teilt euerAusZeilen nach dem Vorzeichen; jede Richtung hat ihre Zeile
      const zeilen =
        zuordnung === "ustZahlung"
          ? [form43Zeile(kr, "gezahlteUst"), form43Zeile(kr, "erstatteteUst")]
          : zuordnung === "nichtAbziehbar"
            ? ["steuernVersicherungenBeitraege"]
            : [form43Zeile(kr, zuordnung)];
      for (const zeile of zeilen) expect(ZEILEN.has(zeile), `${kr} ${konto} (${zuordnung})`).toBe(true);
    }
  });

  it.each(["SKR03", "SKR04"] as const)("%s: jedes Konto mit einem Posten der GuV hat eine Kostenart und damit eine Zeile", (kr) => {
    let erfolgskonten = 0;
    for (const konto of konten(kr)) {
      const posten = postenOf(kr, konto);
      if (posten === null || posten.startsWith("aktiva.") || posten.startsWith("passiva.")) continue;
      erfolgskonten++;
      expect(kostenartOf(kr, konto), `${kr} ${konto} (${posten})`).not.toBeNull();
    }
    expect(erfolgskonten).toBeGreaterThan(50);
  });
});

describe("Abweichung zum Vergleich", () => {
  it("in Cent und Basispunkten des Vergleichs", () => {
    expect(abweichung(4_800_000, 4_100_000)).toEqual({ betrag: 700_000, prozent: 1_707 });
    expect(abweichung(240_000, 90_000)).toEqual({ betrag: 150_000, prozent: 16_667 });
    expect(abweichung(-50_000, -100_000)).toEqual({ betrag: 50_000, prozent: 5_000 });
  });

  it("ohne Prozent, wenn der Vergleich 0 ist", () => {
    expect(abweichung(10_000, 0)).toEqual({ betrag: 10_000, prozent: null });
  });
});
