import { ASSET_ACCOUNTS } from "./afa.ts";
import { DARLEHEN_KONTEN } from "./darlehen.ts";
import type { EuerLineKey } from "./euer.ts";
import type { JournalZeile } from "./journal-kennzahlen.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { roundHalfAwayFromZero, type Cents } from "./money.ts";
import { PAUSCHALE_KONTEN, type PauschaleArt } from "./pauschalen.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";
import { PRIVATE_USE_ACCOUNTS } from "./private-use.ts";
import { abziehbareNebenleistungen, nichtAbziehbareNebenleistungen, STEUER_KONTEN } from "./steuerzahlung.ts";

/*
 * EÜR-Zeilen aus Konto und Herkunft der Journalzeilen (#542, Schritt 5a). Die EÜR rechnet heute aus den Nebenbüchern
 * (computeEuer); diese Zuordnung ist die Grundlage, sie aus dem Journal nachzurechnen (Schritt 5b). Sie ordnet nur zu:
 * Wann eine Zeile in die EÜR gehört (Zufluss und Abfluss nach § 11 EStG), entscheidet der Aufrufer, etwa indem er eine
 * Zahlung anteilig auf die Zeilen der Rechnung bzw. des Belegs verteilt, die sie ausgleicht.
 *
 * Wie computeEuer: Die selbst geschuldete Steuer nach § 13b und beim innergemeinschaftlichen Erwerb zählt nicht (sie
 * steht als Umsatz- und Vorsteuer gleich hoch im Journal), die Einfuhrumsatzsteuer ist Vorsteuer, eine Anlage wirkt über
 * die AfA, ein Privatanteil ist Entnahme, die Gewerbesteuer und nicht abziehbare Nebenleistungen stehen nur nachrichtlich,
 * von der Bewirtung sind 70 % abziehbar.
 *
 * Die Summe gilt je Buchung (`euerAusZeilen` mit den Zeilen einer Buchung): Eine Ausbuchung (Skonto, Forderungsausfall)
 * wirkt als Ganzes nicht, in der EÜR zählt nur, was gezahlt wird; in einer Buchung mit § 13b oder Erwerb wirkt die nicht
 * abziehbare Steuer (keineVSt) nicht, sie geht mit der Voranmeldung ans Finanzamt.
 *
 * Was die Buchung allein nicht sagt, gibt der Aufrufer als Herkunft mit: Gebühren eines Darlehens stehen auf einem Konto,
 * die EÜR trennt sie nach dem Zweck (Herkunft „darlehenAnlagevermoegen“); das GWG-Konto (SKR03 0480, SKR04 0670) ist bei
 * einem Beleg die Kategorie „Hardware“, bei einer Anlage (Herkunft „anlage“ bzw. „asset“) Anlagevermögen ohne Wirkung.
 *
 * Eine Zahlung auf eine Rechnung oder einen Beleg verteilt `zahlungsAnteil` auf deren Zeilen (#542, Schritt 5b).
 */

/** Zeilen der EÜR, deren Betrag eine Einnahme ist (Haben − Soll); alle übrigen sind Ausgaben (Soll − Haben) */
const EINNAHMEN: ReadonlySet<EuerLineKey> = new Set<EuerLineKey>([
  "einnahmenKleinunternehmer",
  "einnahmenSteuerpflichtig",
  "einnahmenSteuerfrei",
  "privateKfz",
  "ustEntnahmen",
  "vereinnahmteUst",
  "kursgewinne",
]);

/** Steuerschlüssel der Bemessungsgrundlage bei selbst geschuldeter Steuer (§ 13b, innergemeinschaftlicher Erwerb) */
const SELBST_GESCHULDET: ReadonlySet<string> = new Set(["RC13bEU", "RC13bDrittland", "IGE19", "IGE7"]);

/** Was eine Zeile in der EÜR bewirkt, außer einer festen Zeile: Umsatzsteuer an das bzw. vom Finanzamt, nachrichtlich */
export type EuerZuordnung = EuerLineKey | "ustZahlung" | "nichtAbziehbar";

/**
 * Herkunft der Buchung, soweit sie die Zuordnung ändert: „anlage“ ist ein Beleg der Kategorie Anlage, „asset“ eine Buchung
 * des Anlagenverzeichnisses, „darlehenAnlagevermoegen“ eine Zahlung auf ein Darlehen für Anlagevermögen
 */
export type EuerHerkunft = "pauschale" | "asset" | "anlage" | "darlehenAnlagevermoegen" | "sonst";

/**
 * Die EÜR-Zeile eines Kontos, oder null, wenn es in der EÜR nicht wirkt (Bank, Kasse, Forderungen, Verbindlichkeiten,
 * Privatkonten, Anlagekonten, Darlehen, Steuer nach § 13b und Erwerb). Die Pauschale „Fahrt“ teilt ihr Konto mit den
 * Fahrtkosten; die Herkunft unterscheidet sie. Die Umsatzsteuer auf die Privatnutzung (Herkunft „asset“) ist eine eigene Zeile.
 */
export function euerZuordnung(kontenrahmen: Kontenrahmen, account: string, herkunft: EuerHerkunft = "sonst"): EuerZuordnung | null {
  const a = ACCOUNTS[kontenrahmen];
  if (herkunft === "pauschale") {
    for (const [art, konten] of Object.entries(PAUSCHALE_KONTEN) as [PauschaleArt, (typeof PAUSCHALE_KONTEN)[PauschaleArt]][])
      if (konten[kontenrahmen].konto === account) return `pauschale:${art}`;
  }
  // Umsatzsteuer: vereinnahmt, auch noch nicht fällig (sie wird es mit der Zahlung); auf die Privatnutzung eigene Zeile
  if (account === a.ust[1900] || account === a.ust[700]) return herkunft === "asset" ? "ustEntnahmen" : "vereinnahmteUst";
  if (account === a.ustNichtFaellig[1900] || account === a.ustNichtFaellig[700]) return "vereinnahmteUst";
  if (account === a.vorsteuer[1900] || account === a.vorsteuer[700]) return "vorsteuer";
  if (account === EXPENSE_CATEGORIES.einfuhrumsatzsteuer[kontenrahmen]) return "vorsteuer";
  const steuer = STEUER_KONTEN[kontenrahmen];
  if ([a.ustVorauszahlung, a.sondervorauszahlung, steuer.ustVorjahr, steuer.ustFruehereJahre].includes(account as never)) return "ustZahlung";
  // Erlöse
  if (account === a.erloese[1900] || account === a.erloese[700]) return "einnahmenSteuerpflichtig";
  if (account === a.erloeseSonder.kleinunternehmer) return "einnahmenKleinunternehmer";
  if (account === a.erloese[0] || Object.values(a.erloeseSonder).includes(account as never)) return "einnahmenSteuerfrei";
  if (account === a.mahnerloes || account === a.zinsertraege || account === steuer.erstattungszinsen) return "einnahmenSteuerfrei";
  if (account === a.kursErtrag) return "kursgewinne";
  if (account === a.kursAufwand) return "kursverluste";
  // Privatnutzung von Fahrzeugen
  const privat = PRIVATE_USE_ACCOUNTS[kontenrahmen];
  if (account === privat.mitUst || account === privat.ohneUst) return "privateKfz";
  // Anlagen: AfA, GWG, Sammelposten, Restbuchwert; die Anschaffung selbst wirkt nicht
  const anlage = ASSET_ACCOUNTS[kontenrahmen];
  // Das GWG-Konto ist bei einer Anlage Anlagevermögen, bei einem Beleg die Kategorie „Hardware“ (unten)
  if ((herkunft === "asset" || herkunft === "anlage") && account === anlage.gwg) return null;
  if (account === anlage.afa || account === anlage.afaKfz) return "afa";
  if (account === anlage.afaGwg) return "gwg";
  if (account === anlage.afaSammelposten) return "sammelposten";
  if (account === anlage.restbuchwert) return "restbuchwert";
  // Steuerzahlungen und Nebenleistungen
  if (abziehbareNebenleistungen(kontenrahmen).includes(account)) return "steuerNebenleistungen";
  if (account === steuer.gewst || account === steuer.gewstVorjahre || nichtAbziehbareNebenleistungen(kontenrahmen).includes(account)) return "nichtAbziehbar";
  // Darlehen: Zinsen und Gebühren
  const darlehen = DARLEHEN_KONTEN[kontenrahmen];
  if (account === darlehen.zinsenAnlagevermoegen) return "schuldzinsenAnlage";
  if (account === darlehen.gebuehren) return herkunft === "darlehenAnlagevermoegen" ? "schuldzinsenAnlage" : "schuldzinsen";
  if (account === darlehen.zinsenKurzfristig || account === darlehen.zinsenLangfristig) return "schuldzinsen";
  // Personal: Aufwand der Lohnabrechnung und, bei der Zahlung, die Verbindlichkeiten daraus
  const lohn = LOHN_KONTEN[kontenrahmen];
  if (Object.values(lohn).includes(account as never)) return "personal";
  // Aufwand je Kategorie; Anlagegut und Einfuhrumsatzsteuer oben bzw. ohne Wirkung
  for (const [kategorie, konten] of Object.entries(EXPENSE_CATEGORIES) as [ExpenseCategory, (typeof EXPENSE_CATEGORIES)[ExpenseCategory]][]) {
    if (kategorie === "anlage" || kategorie === "einfuhrumsatzsteuer") continue;
    if (konten[kontenrahmen] === account) return `ausgabe:${kategorie}`;
  }
  return null;
}

export interface EuerAusJournal {
  zeilen: Partial<Record<EuerLineKey, Cents>>;
  /** Nicht abziehbarer Teil der Bewirtung (30 %), wie EuerResult.bewirtungNichtAbziehbar */
  bewirtungNichtAbziehbar: Cents;
  /** Gewerbesteuer und nicht abziehbare Nebenleistungen, wie EuerResult.gewerbesteuerNichtAbziehbar */
  gewerbesteuerNichtAbziehbar: Cents;
}

export function leereEuerAusJournal(): EuerAusJournal {
  return { zeilen: {}, bewirtungNichtAbziehbar: 0, gewerbesteuerNichtAbziehbar: 0 };
}

/**
 * Addiert die EÜR-Wirkung von Journalzeilen zu `summe`; der Aufrufer wählt die Zeilen und, bei einer Zahlung auf eine
 * Rechnung oder einen Beleg, deren anteilige Beträge. Zeilen mit nur einer Bemessungsgrundlage (ohne Betrag) wirken nicht.
 */
export function euerAusZeilen(
  kontenrahmen: Kontenrahmen,
  zeilen: readonly Pick<JournalZeile, "account" | "debit" | "credit" | "taxCode">[],
  herkunft: EuerHerkunft = "sonst",
  summe: EuerAusJournal = leereEuerAusJournal(),
): EuerAusJournal {
  const add = (key: EuerLineKey, betrag: Cents) => {
    if (betrag !== 0) summe.zeilen[key] = (summe.zeilen[key] ?? 0) + betrag;
  };
  const a = ACCOUNTS[kontenrahmen];
  // Ausbuchung: computeEuer zählt nur Zahlungen, Skonto und Forderungsausfall wirken nicht
  if (zeilen.some((z) => z.account === a.skontiGewaehrt || z.account === a.skontiErhalten || z.account === a.forderungsverluste)) return summe;
  // § 13b und Erwerb: die nicht abziehbare Steuer geht mit der Voranmeldung ans Finanzamt, sie ist keine Ausgabe des Belegs
  const selbstGeschuldet = zeilen.some((z) => z.taxCode !== null && SELBST_GESCHULDET.has(z.taxCode));
  for (const zeile of zeilen) {
    if (selbstGeschuldet && zeile.taxCode === "keineVSt") continue;
    const zuordnung = euerZuordnung(kontenrahmen, zeile.account, herkunft);
    if (zuordnung === null) continue;
    const soll = zeile.debit - zeile.credit;
    if (zuordnung === "ustZahlung") {
      // Soll: an das Finanzamt gezahlt; Haben: erstattet
      if (soll > 0) add("gezahlteUst", soll);
      else add("erstatteteUst", -soll);
    } else if (zuordnung === "nichtAbziehbar") {
      summe.gewerbesteuerNichtAbziehbar += soll;
    } else if (zuordnung === "ausgabe:bewirtung") {
      // 30 % sind nicht abziehbar (§ 4 Abs. 5 Nr. 2 EStG), gerundet wie computeEuer
      const abziehbar = roundHalfAwayFromZero((soll * 7) / 10);
      add(zuordnung, abziehbar);
      summe.bewirtungNichtAbziehbar += soll - abziehbar;
    } else {
      add(zuordnung, EINNAHMEN.has(zuordnung) ? -soll : soll);
    }
  }
  return summe;
}

type Zeile = Pick<JournalZeile, "account" | "debit" | "credit" | "taxCode">;

const sollSaldo = (z: Zeile) => z.debit - z.credit;
const alsZeile = (z: Zeile, saldo: Cents): Zeile => ({ ...z, debit: saldo > 0 ? saldo : 0, credit: saldo < 0 ? -saldo : 0 });

/** Rest auf die Zeile mit dem größten Betrag, sodass die Anteile genau `ziel` ergeben (wie paidTaxShares) */
function mitRest(anteile: Cents[], betraege: Cents[], ziel: Cents): Cents[] {
  if (anteile.length === 0) return anteile;
  const groesste = betraege.reduce((best, b, i) => (Math.abs(b) > Math.abs(betraege[best]!) ? i : best), 0);
  const rest = ziel - anteile.reduce((s, a) => s + a, 0);
  return anteile.map((a, i) => (i === groesste ? a + rest : a));
}

/** Anteil der Zeilen bei `bezahlt` von `gesamt`, gerundet wie paidTaxShares: erst die Steuer, das Übrige ist Netto */
function anteilBei(kontenrahmen: Kontenrahmen, zeilen: readonly Zeile[], gesamt: Cents, bezahlt: Cents): Cents[] {
  const anteil = (v: Cents) => roundHalfAwayFromZero((v * bezahlt) / gesamt);
  const istSteuer = zeilen.map((z) => {
    const zuordnung = euerZuordnung(kontenrahmen, z.account);
    return zuordnung === "vereinnahmteUst" || zuordnung === "vorsteuer";
  });
  const gruppe = (steuer: boolean) => zeilen.map((z, i) => ({ i, saldo: sollSaldo(z) })).filter((x) => istSteuer[x.i] === steuer);
  const steuer = gruppe(true);
  const netto = gruppe(false);
  const steuerSumme = anteil(steuer.reduce((s, x) => s + x.saldo, 0));
  // Die Zeilen ohne offenen Posten ergeben zusammen −gesamt; ihr Anteil −bezahlt
  const nettoSumme = -bezahlt - steuerSumme;
  const ergebnis: Cents[] = zeilen.map(() => 0);
  for (const [teil, summe] of [
    [steuer, steuerSumme],
    [netto, nettoSumme],
  ] as const) {
    const werte = mitRest(
      teil.map((x) => anteil(x.saldo)),
      teil.map((x) => x.saldo),
      summe,
    );
    teil.forEach((x, k) => {
      ergebnis[x.i] = werte[k]!;
    });
  }
  return ergebnis;
}

/**
 * Anteil einer Zahlung (oder Ausbuchung) an den Zeilen der Buchung, die sie ausgleicht (#542, Schritt 5b). `zeilen` sind die
 * Zeilen ohne offenen Posten (ohne Forderungen bzw. Verbindlichkeiten), `gesamt` der offene Posten der Buchung (Soll − Haben,
 * bei einer Rechnung positiv), `betrag` der ausgeglichene Teil mit demselben Vorzeichen, `bisher` was frühere Zahlungen
 * schon ausgeglichen haben.
 *
 * Gerundet wie die Nebenbücher: erst die Steuer anteilig, das Übrige ist Netto, der Rest auf die größte Zeile
 * (paidTaxShares). Mit `bisher` wie settlementTaxShares: der Anteil am dann Ausgeglichenen abzüglich des Anteils davor,
 * sodass alle Zahlungen zusammen genau die Zeilen der Buchung ergeben.
 */
export function zahlungsAnteil(kontenrahmen: Kontenrahmen, zeilen: readonly Zeile[], gesamt: Cents, betrag: Cents, bisher: Cents = 0): Zeile[] {
  if (gesamt === 0) return [];
  const danach = anteilBei(kontenrahmen, zeilen, gesamt, bisher + betrag);
  const davor = bisher === 0 ? zeilen.map(() => 0) : anteilBei(kontenrahmen, zeilen, gesamt, bisher);
  return zeilen.map((z, i) => alsZeile(z, danach[i]! - davor[i]!));
}
