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
 * Offen für Schritt 5b, weil das Konto allein nicht reicht:
 * - Gebühren eines Darlehens stehen auf einem Konto, die EÜR trennt sie nach dem Zweck des Darlehens (Anlagevermögen oder
 *   nicht); hier zählen sie als übrige Schuldzinsen.
 * - Die Kategorie „Hardware (GWG)“ bucht auf das GWG-Konto (SKR03 0480, SKR04 0670), das auch ein Anlagegut als GWG
 *   anspricht; hier zählt es als Ausgabe „Hardware“, ein Anlagegut darauf wirkt aber nur über die AfA. 5b unterscheidet
 *   über die Kategorie des Belegs.
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

/** Was eine Zeile in der EÜR bewirkt, außer einer festen Zeile: Umsatzsteuer an das bzw. vom Finanzamt, nachrichtlich */
export type EuerZuordnung = EuerLineKey | "ustZahlung" | "nichtAbziehbar";

/** Herkunft der Buchung, soweit sie die Zuordnung ändert */
export type EuerHerkunft = "pauschale" | "asset" | "sonst";

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
  if (account === darlehen.zinsenKurzfristig || account === darlehen.zinsenLangfristig || account === darlehen.gebuehren) return "schuldzinsen";
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
  zeilen: readonly Pick<JournalZeile, "account" | "debit" | "credit">[],
  herkunft: EuerHerkunft = "sonst",
  summe: EuerAusJournal = leereEuerAusJournal(),
): EuerAusJournal {
  const add = (key: EuerLineKey, betrag: Cents) => {
    if (betrag !== 0) summe.zeilen[key] = (summe.zeilen[key] ?? 0) + betrag;
  };
  for (const zeile of zeilen) {
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
