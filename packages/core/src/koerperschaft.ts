import type { BasisPoints, Cents, Prozent } from "./money.ts";
import { EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";
import { nichtAbziehbareNebenleistungen } from "./steuerzahlung.ts";

/*
 * Körperschaftsteuer, Solidaritätszuschlag und Gewerbesteuer einer GmbH oder UG aus dem Jahresergebnis, als Grundlage
 * für die Steuerrückstellungen im Jahresabschluss und die Erklärungen. Die Konten stammen aus dem DATEV-Kontenrahmen
 * 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175).
 *
 * Gerechnet wird, was eine kleine GmbH typischerweise hat: nicht abziehbare Aufwendungen (Steuern vom Einkommen und
 * Ertrag, Gewerbesteuer, nicht abziehbare Bewirtung und Geschenke), Verlustvortrag mit Mindestbesteuerung, die
 * Hinzurechnung nach § 8 Nr. 1 GewStG. Nicht berücksichtigt: steuerfreie Erträge (§ 8b KStG), Spendenabzug (§ 9 KStG),
 * verdeckte Gewinnausschüttungen und Einlagen, Kürzungen nach § 9 GewStG, Verlustrücktrag (§ 10d Abs. 1 EStG).
 */

/** § 23 Abs. 1 KStG */
export const KST_SATZ: BasisPoints = 1500;
/** § 4 SolZG */
export const SOLI_SATZ: BasisPoints = 550;
/** § 11 Abs. 2 GewStG */
export const GEWST_MESSZAHL: BasisPoints = 350;
/** § 8 Nr. 1 GewStG */
export const GEWST_HINZURECHNUNG_FREIBETRAG: Cents = 20_000_000;
/** Sockel der Mindestbesteuerung (§ 10d Abs. 2 EStG, § 10a GewStG) */
export const VERLUST_SOCKEL: Cents = 100_000_000;
/**
 * Mindesthebesatz eines Erhebungszeitraums: Er gilt, wenn die Gemeinde keinen höheren bestimmt hat (§ 16 Abs. 4 Satz 2
 * GewStG). 280 % erstmals für 2027 (§ 36 Abs. 5b GewStG), davor 200 %. Geändert durch Art. 8 des Gesetzes vom
 * 29.06.2026 (BGBl. 2026 I Nr. 197); § 36 Abs. 5b verweist auf Art. 7, der aber das EStG ändert.
 */
export const mindestHebesatz = (year: number): Prozent => (year >= 2027 ? 280 : 200);

/** Über dem Sockel abziehbarer Anteil in Basispunkten: KSt 70 % für 2024 bis 2027 (Wachstumschancengesetz), sonst 60 % */
const verlustQuoteKst = (year: number): BasisPoints => (year >= 2024 && year <= 2027 ? 7000 : 6000);
const VERLUST_QUOTE_GEWST: BasisPoints = 6000;

const KONTEN = {
  SKR03: {
    kst: ["2200"],
    soli: ["2208"],
    gewst: ["4320"],
    /** Für Vorjahre und Erstattungen; Soli auch auf Kapitalertragsteuer; Gewerbesteuer nach § 4 Abs. 5b EStG */
    kstVorjahre: ["2203", "2204"],
    soliWeitere: ["2209", "2210", "2216"],
    kapest: ["2213"],
    gewstVorjahre: ["2281", "2283"],
    /** Nicht abziehbare Geschenke, Bewirtung und eingeschränkt abziehbare Betriebsausgaben */
    nichtAbziehbar: ["4635", "4636", "4637", "4652", "4654", "4655"],
    rueckstellungKst: "0963",
    rueckstellungGewst: "0956",
  },
  SKR04: {
    kst: ["7600"],
    soli: ["7608"],
    gewst: ["7610"],
    kstVorjahre: ["7603", "7604"],
    soliWeitere: ["7607", "7609", "7633"],
    kapest: ["7630"],
    gewstVorjahre: ["7641", "7643"],
    nichtAbziehbar: ["6620", "6621", "6622", "6642", "6644", "6645"],
    rueckstellungKst: "3040",
    rueckstellungGewst: "3035",
  },
} as const;

/** Konten für die Rückstellung und den Aufwand der Steuern */
export function steuerKonten(kontenrahmen: Kontenrahmen) {
  const k = KONTEN[kontenrahmen];
  return { kst: k.kst[0], soli: k.soli[0], gewst: k.gewst[0], rueckstellungKst: k.rueckstellungKst, rueckstellungGewst: k.rueckstellungGewst };
}

/**
 * Hinzurechnung nach § 8 Nr. 1 GewStG: Anteil je Kontengruppe in Basispunkten. Zinsen voll (a), Renten und dauernde
 * Lasten voll (b), Miete und Leasing beweglicher Wirtschaftsgüter 20 % (d), unbeweglicher 50 % (e), zeitlich befristete
 * Überlassung von Rechten 25 % (f). Für Elektrofahrzeuge, begünstigte Hybridelektrofahrzeuge und Fahrräder gilt nur die
 * Hälfte von 20 % (d Satz 2); ob ein Vertrag dazu gehört, entscheidet, wer auf das Konto bucht.
 *
 * Die Konten tragen im DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175) das Kennzeichen G; die Gruppen
 * sind in beiden Kontenrahmen gleich groß (koerperschaft.test.ts). Das G bildet nur die Programmverbindung ab, nicht den
 * steuerlichen Ursprung (Fußnote 4 und „Erläuterungen zur Kennzeichnung“); nicht alle Konten damit gehören hierher. Nicht
 * dabei sind die Zinsen nach §§ 233a bis 237 AO, Abschreibungen auf ein Disagio, Vergütungen an Mitunternehmer und
 * Aufwendungen nach §§ 3 Nr. 40, 3c EStG bzw. § 8b KStG (etwa 2115, 2116 / 7350, 7351, Fußnote 9).
 */
export type HinzurechnungArt = "zinsen" | "renten" | "beweglich" | "elektro" | "unbeweglich" | "rechte";
const HINZURECHNUNG: Record<Kontenrahmen, readonly [art: HinzurechnungArt, konten: readonly string[], anteil: BasisPoints, text: string][]> = {
  SKR03: [
    // Mit den Zinsen zur Finanzierung des Anlagevermögens aus dem Darlehen (darlehen.ts), an verbundene Unternehmen,
    // auf Kontokorrentkonten und für Gebäude
    ["zinsen", ["2100", "2109", "2110", "2118", "2119", "2120", "2125", "2126", "2129"], 10_000, "Zinsen (§ 8 Nr. 1 a)"],
    ["renten", ["2127"], 10_000, "Renten und dauernde Lasten (§ 8 Nr. 1 b)"],
    // Mit Mietleasing für technische Anlagen und Maschinen (4810) und Betriebs- und Geschäftsausstattung (4965)
    ["beweglich", ["4570", "4810", "4960", "4961", "4963", "4965"], 2000, "Miete, Pacht und Leasing beweglicher Wirtschaftsgüter (§ 8 Nr. 1 d)"],
    ["elektro", ["4575"], 1000, "Miete und Leasing für Elektrofahrzeuge und Fahrräder (§ 8 Nr. 1 d Satz 2)"],
    // Mit Garagenmiete
    ["unbeweglich", ["4210", "4211", "4215", "4220", "4550"], 5000, "Miete, Pacht und Leasing unbeweglicher Wirtschaftsgüter (§ 8 Nr. 1 e)"],
    ["rechte", ["4964"], 2500, "Überlassung von Rechten (§ 8 Nr. 1 f)"],
  ],
  SKR04: [
    ["zinsen", ["7300", "7309", "7310", "7318", "7319", "7320", "7325", "7326", "7329"], 10_000, "Zinsen (§ 8 Nr. 1 a)"],
    ["renten", ["7327"], 10_000, "Renten und dauernde Lasten (§ 8 Nr. 1 b)"],
    ["beweglich", ["6498", "6560", "6835", "6836", "6838", "6840"], 2000, "Miete, Pacht und Leasing beweglicher Wirtschaftsgüter (§ 8 Nr. 1 d)"],
    ["elektro", ["6565"], 1000, "Miete und Leasing für Elektrofahrzeuge und Fahrräder (§ 8 Nr. 1 d Satz 2)"],
    ["unbeweglich", ["6310", "6315", "6316", "6317", "6550"], 5000, "Miete, Pacht und Leasing unbeweglicher Wirtschaftsgüter (§ 8 Nr. 1 e)"],
    ["rechte", ["6837"], 2500, "Überlassung von Rechten (§ 8 Nr. 1 f)"],
  ],
};

/**
 * § 8 Nr. 1 Buchst. d Satz 2 GewStG gilt nur für Verträge, die nach dem 31.12.2019 abgeschlossen worden sind, und
 * letztmals für den Erhebungszeitraum 2030 (§ 36 Abs. 4 Sätze 1 und 3 GewStG)
 */
const ELEKTRO_AB = 2020;
const ELEKTRO_BIS = 2030;

/** Die Gruppen eines Jahres; vor 2020 und nach 2030 zählt das Leasing für Elektrofahrzeuge und Fahrräder zum übrigen beweglichen */
function hinzurechnungGruppen(kontenrahmen: Kontenrahmen, year: number) {
  const gruppen = HINZURECHNUNG[kontenrahmen];
  if (year >= ELEKTRO_AB && year <= ELEKTRO_BIS) return gruppen;
  const elektro = gruppen.find(([art]) => art === "elektro")?.[1] ?? [];
  return gruppen
    .filter(([art]) => art !== "elektro")
    .map(([art, konten, anteil, text]) => [art, art === "beweglich" ? [...konten, ...elektro] : konten, anteil, text] as const);
}

/** Die Konten der Hinzurechnung je Kontenrahmen, nach Art; eigene Sachkonten (#270) dürfen sie nicht belegen */
export const GEWST_HINZURECHNUNG_KONTEN: Record<Kontenrahmen, Record<string, readonly string[]>> = {
  SKR03: Object.fromEntries(HINZURECHNUNG.SKR03.map(([art, konten]) => [art, konten])),
  SKR04: Object.fromEntries(HINZURECHNUNG.SKR04.map(([art, konten]) => [art, konten])),
};

/** Nicht abziehbarer Teil der Bewirtung (§ 4 Abs. 5 Nr. 2 EStG); Haben bucht sie voll auf das Bewirtungskonto */
const BEWIRTUNG_NICHT_ABZIEHBAR: BasisPoints = 3000;

export interface KapgSteuerAngaben {
  /** Hebesatz der Gemeinde in Prozent, z. B. 400 */
  hebesatz: Prozent;
  /** Verbleibender Verlustvortrag zum 31.12. des Vorjahres laut Bescheid */
  verlustvortragKst: Cents;
  /** Vortragsfähiger Gewerbeverlust zum 31.12. des Vorjahres laut Bescheid */
  verlustvortragGewst: Cents;
  /** Im Verlustjahr: Rücktrag in die zwei Vorjahre (höchstens 1 Mio. €, § 10d Abs. 1 EStG); 0 = Verzicht */
  verlustruecktrag?: Cents;
}

export interface KapgSteuerZeile {
  text: string;
  betrag: Cents;
}

/** Zeile der Anlage GK, in die eine Hinzurechnung gehört (Zeilen 81 bis 84 und 90) */
export type HinzurechnungGk = "kst" | "soli" | "kapest" | "gewst" | "sonstige";

export interface KapgSteuern {
  jahresergebnis: Cents;
  /** Nicht abziehbare Aufwendungen, die das Einkommen erhöhen (Erstattungen negativ) */
  hinzurechnungen: (KapgSteuerZeile & { gk: HinzurechnungGk })[];
  /** Einkommen vor Verlustabzug; zugleich Gewinn aus Gewerbebetrieb (§ 7 GewStG) */
  einkommen: Cents;
  verlustabzugKst: Cents;
  /** Zu versteuerndes Einkommen, volle Euro */
  zvE: Cents;
  kst: Cents;
  soli: Cents;
  verlustvortragKst: Cents;
  /** Hinzurechnung je Gruppe: Aufwand in voller Höhe (brutto) und der Anteil daraus (betrag) */
  gewstHinzurechnungen: (KapgSteuerZeile & { art: HinzurechnungArt; brutto: Cents; anteil: BasisPoints })[];
  /** Hinzurechnung nach § 8 Nr. 1 GewStG: ein Viertel der Summe über dem Freibetrag */
  hinzurechnungGewst: Cents;
  verlustabzugGewst: Cents;
  /** Gewerbeertrag, auf volle 100 € abgerundet (§ 11 Abs. 1 Satz 3 GewStG); kein Freibetrag bei Kapitalgesellschaften */
  gewerbeertrag: Cents;
  messbetrag: Cents;
  gewst: Cents;
  verlustvortragGewst: Cents;
  /** Schon als Aufwand gebucht (Vorauszahlungen, frühere Rückstellung), Soll positiv */
  gebucht: { kst: Cents; soli: Cents; gewst: Cents };
  /** Noch zu buchende Rückstellung, Körperschaftsteuer mit Soli (negativ: Erstattung) */
  rueckstellung: { kst: Cents; gewst: Cents };
}

const anteil = (betrag: Cents, basispunkte: BasisPoints): Cents => Math.floor((betrag * basispunkte) / 10_000);

/** Verlustabzug mit Mindestbesteuerung: bis zum Sockel voll, darüber nur die Quote des übersteigenden Betrags */
function verlustabzug(einkommen: Cents, vortrag: Cents, quote: BasisPoints): Cents {
  if (einkommen <= 0 || vortrag <= 0) return 0;
  const grenze = Math.min(einkommen, VERLUST_SOCKEL) + anteil(Math.max(0, einkommen - VERLUST_SOCKEL), quote);
  return Math.min(vortrag, grenze);
}

const abrunden = (betrag: Cents, auf: Cents) => (betrag > 0 ? Math.floor(betrag / auf) * auf : 0);

/**
 * Steuern des Jahres aus den GuV-Salden (Soll − Haben, nur das Jahr) und dem Jahresergebnis. Die schon gebuchten
 * Steuern werden wieder hinzugerechnet; deshalb ändert eine gebuchte Rückstellung das Ergebnis nicht.
 */
export function kapgSteuern(
  kontenrahmen: Kontenrahmen,
  year: number,
  salden: readonly { account: string; saldo: Cents }[],
  jahresergebnis: Cents,
  angaben: KapgSteuerAngaben,
): KapgSteuern {
  const saldo = new Map<string, Cents>();
  for (const s of salden) saldo.set(s.account, (saldo.get(s.account) ?? 0) + s.saldo);
  const summe = (konten: readonly string[]) => konten.reduce((sum, k) => sum + (saldo.get(k) ?? 0), 0);
  const k = KONTEN[kontenrahmen];

  const bewirtung = Math.max(0, saldo.get(EXPENSE_CATEGORIES.bewirtung[kontenrahmen]) ?? 0);
  const hinzurechnungen: (KapgSteuerZeile & { gk: HinzurechnungGk })[] = [
    { gk: "kst" as const, text: "Körperschaftsteuer (§ 10 Nr. 2 KStG)", betrag: summe([...k.kst, ...k.kstVorjahre]) },
    { gk: "soli" as const, text: "Solidaritätszuschlag (§ 10 Nr. 2 KStG)", betrag: summe([...k.soli, ...k.soliWeitere]) },
    { gk: "kapest" as const, text: "Kapitalertragsteuer (§ 10 Nr. 2 KStG)", betrag: summe(k.kapest) },
    { gk: "gewst" as const, text: "Gewerbesteuer (§ 4 Abs. 5b EStG)", betrag: summe([...k.gewst, ...k.gewstVorjahre]) },
    { gk: "sonstige" as const, text: "Nicht abziehbare Geschenke, Bewirtung und Betriebsausgaben (§ 4 Abs. 5 EStG)", betrag: summe(k.nichtAbziehbar) },
    // Zinsen und Zuschläge zu Körperschaft- und Gewerbesteuer (steuerzahlung.ts); die Konten trennen die Steuerart nicht
    {
      gk: "sonstige" as const,
      text: "Nicht abziehbare Nebenleistungen zu Steuern (§ 10 Nr. 2 KStG, § 4 Abs. 5b EStG)",
      betrag: summe(nichtAbziehbareNebenleistungen(kontenrahmen)),
    },
    {
      gk: "sonstige" as const,
      text: "30 % der Bewirtungskosten (§ 4 Abs. 5 Nr. 2 EStG)",
      betrag: Math.round((bewirtung * BEWIRTUNG_NICHT_ABZIEHBAR) / 10_000),
    },
  ].filter((z) => z.betrag !== 0);
  const einkommen = jahresergebnis + hinzurechnungen.reduce((sum, z) => sum + z.betrag, 0);

  const verlustabzugKst = verlustabzug(einkommen, angaben.verlustvortragKst, verlustQuoteKst(year));
  // Den Rücktrag gibt es bei der Gewerbesteuer nicht (§ 10a GewStG)
  const ruecktrag = Math.min(angaben.verlustruecktrag ?? 0, Math.max(0, -einkommen), VERLUST_SOCKEL);
  const zvE = abrunden(einkommen - verlustabzugKst, 100);
  const kst = anteil(zvE, KST_SATZ);
  const soli = anteil(kst, SOLI_SATZ);

  const gewstHinzurechnungen = hinzurechnungGruppen(kontenrahmen, year)
    .map(([art, konten, quote, text]) => {
      const brutto = Math.max(0, summe(konten));
      return { art, text, brutto, anteil: quote, betrag: anteil(brutto, quote) };
    })
    .filter((z) => z.betrag !== 0);
  const gewichtet = gewstHinzurechnungen.reduce((sum, z) => sum + z.betrag, 0);
  const hinzurechnungGewst = anteil(Math.max(0, gewichtet - GEWST_HINZURECHNUNG_FREIBETRAG), 2500);
  const gewerbeertragVorVerlust = einkommen + hinzurechnungGewst;
  const verlustabzugGewst = verlustabzug(gewerbeertragVorVerlust, angaben.verlustvortragGewst, VERLUST_QUOTE_GEWST);
  const gewerbeertrag = abrunden(gewerbeertragVorVerlust - verlustabzugGewst, 10_000);
  const messbetrag = anteil(gewerbeertrag, GEWST_MESSZAHL);
  const gewst = Math.floor((messbetrag * angaben.hebesatz) / 100);

  const gebucht = { kst: summe(k.kst), soli: summe(k.soli), gewst: summe(k.gewst) };
  return {
    jahresergebnis,
    hinzurechnungen,
    einkommen,
    verlustabzugKst,
    zvE,
    kst,
    soli,
    verlustvortragKst: angaben.verlustvortragKst - verlustabzugKst + Math.max(0, -einkommen) - ruecktrag,
    gewstHinzurechnungen,
    hinzurechnungGewst,
    verlustabzugGewst,
    gewerbeertrag,
    messbetrag,
    gewst,
    verlustvortragGewst: angaben.verlustvortragGewst - verlustabzugGewst + Math.max(0, -gewerbeertragVorVerlust),
    gebucht,
    rueckstellung: { kst: kst + soli - gebucht.kst - gebucht.soli, gewst: gewst - gebucht.gewst },
  };
}

/** Konten, deren Saldo die Steuerberechnung liest */
export const KAPG_STEUER_KONTEN = KONTEN;
