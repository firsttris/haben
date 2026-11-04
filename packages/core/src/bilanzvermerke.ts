import { ebilanzPosition } from "./ebilanz.ts";
import type { Abschluss, BilanzPosten } from "./hgb.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen } from "./posting.ts";

/*
 * Vermerke unter den Posten der Kleinst-Bilanz, die das Gesetz der Kleinstkapitalgesellschaft nicht erlässt:
 *
 * - § 268 Abs. 4 Satz 1 HGB: bei den Forderungen der Betrag mit einer Restlaufzeit von mehr als einem Jahr,
 * - § 268 Abs. 5 Satz 1 HGB: bei den Verbindlichkeiten die Beträge mit einer Restlaufzeit bis zu einem Jahr und von mehr
 *   als einem Jahr. § 274a HGB befreit nur von Abs. 4 Satz 2 und Abs. 5 Satz 3, § 267a Abs. 2 HGB verweist darauf.
 * - § 42 Abs. 3 GmbHG: Ausleihungen, Forderungen und Verbindlichkeiten gegenüber Gesellschaftern gesondert ausweisen
 *   oder im Anhang angeben; stehen sie unter anderen Posten, ist das zu vermerken. Die Kleinst-Bilanz fasst sie in
 *   Anlagevermögen, Umlaufvermögen und Verbindlichkeiten zusammen, einen Anhang gibt es nicht: also als Vermerk.
 *
 * Ohne Anhang stehen die Vermerke in der Bilanz. Welche Konten Forderungen sind, sagt ihre Position in der E-Bilanz
 * (unter bs.ass.currAss.receiv), damit Jahresabschluss, Hinterlegung und E-Bilanz dieselben Beträge zeigen.
 *
 * Quellen: https://www.gesetze-im-internet.de/hgb/__268.html, /hgb/__274a.html, /gmbhg/__42.html, /bgb/__271.html
 * (abgerufen am 04.11.2026); Konten mit Restlaufzeit und gegenüber Gesellschaftern aus dem DATEV-Kontenrahmen 2026
 * (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175).
 */

export type Restlaufzeit = "bis1" | "ueber1";

const konten = (liste: string) => liste.split(" ");

/**
 * Konten, deren Name im DATEV-Kontenrahmen 2026 die Restlaufzeit nennt („- Restlaufzeit bis 1 Jahr“, „1 bis 5 Jahre“,
 * „größer 5 Jahre“, „größer 1 Jahr“); alles über einem Jahr zählt hier zusammen.
 */
const RESTLAUFZEIT_KONTEN: Record<Kontenrahmen, Record<Restlaufzeit, readonly string[]>> = {
  SKR03: {
    bis1: konten(
      "0601 0616 0631 0661 0701 0716 0731 0761 0771 0781 0996 0998 1377 1382 1386 1451 1461 1471 1478 1481 1488 1491 1501 1503 1505 1507 1526 1531 1551 1595 1598 1625 1631 1641 1651 1666 1671 1676 1696 1701 1706 1719 1733 1737 1743 1751",
    ),
    ueber1: konten(
      "0605 0610 0620 0625 0640 0650 0670 0680 0705 0710 0720 0725 0740 0750 0764 0767 0774 0777 0784 0787 0997 0999 1378 1383 1387 1455 1465 1475 1479 1485 1489 1495 1502 1504 1506 1508 1527 1537 1555 1596 1599 1626 1628 1635 1638 1645 1648 1655 1658 1667 1668 1672 1673 1677 1678 1697 1698 1702 1703 1707 1708 1720 1721 1734 1735 1738 1739 1744 1745 1752 1753",
    ),
  },
  SKR04: {
    bis1: konten(
      "1221 1241 1246 1248 1251 1261 1271 1276 1281 1291 1296 1301 1308 1311 1318 1321 1331 1338 1341 1351 1361 3101 3121 3151 3181 3280 3335 3341 3401 3421 3451 3471 3501 3511 3521 3531 3541 3551 3561 3641 3646 3651 3656 3701 3741 3771",
    ),
    ueber1: konten(
      "1225 1245 1247 1249 1255 1265 1275 1277 1285 1295 1297 1305 1309 1315 1319 1325 1335 1339 1345 1355 1365 3105 3110 3125 3130 3160 3170 3190 3200 3284 3285 3337 3338 3345 3348 3405 3410 3425 3430 3455 3460 3475 3480 3504 3507 3514 3517 3524 3527 3534 3537 3544 3547 3554 3557 3564 3567 3642 3643 3647 3648 3652 3653 3657 3658 3710 3715 3750 3755 3780 3785",
    ),
  },
};

/**
 * Konten gegenüber Gesellschaftern einer GmbH im DATEV-Kontenrahmen 2026, je von–bis mit ihren Unterkonten nach
 * Restlaufzeit: Ausleihungen an Gesellschafter und GmbH-Gesellschafter, Forderungen aus Lieferungen und Leistungen gegen
 * Gesellschafter, Forderungen gegen GmbH- und sonstige Gesellschafter, Verbindlichkeiten gegenüber Gesellschaftern (das
 * Verrechnungskonto, auch für offene Ausschüttungen), aus Lieferungen und Leistungen und gegenüber GmbH-Gesellschaftern.
 * Stille Gesellschafter und persönlich haftende Gesellschafter einer Personengesellschaft zählen nicht dazu.
 */
const GESELLSCHAFTER_KONTEN: Record<Kontenrahmen, readonly (readonly [von: string, bis: string])[]> = {
  SKR03: [
    ["0580", "0582"],
    ["0730", "0755"],
    ["1381", "1383"],
    ["1490", "1495"],
    ["1507", "1508"],
    ["1650", "1658"],
    ["1665", "1668"],
  ],
  SKR04: [
    ["0960", "0961"],
    ["1250", "1255"],
    ["1307", "1309"],
    ["1330", "1335"],
    ["3340", "3348"],
    ["3510", "3519"],
    ["3640", "3643"],
  ],
};

/** Restlaufzeit, die das Konto selbst nennt; null = Angabe nötig */
export function restlaufzeitLautKonto(kontenrahmen: Kontenrahmen, account: string): Restlaufzeit | null {
  const liste = RESTLAUFZEIT_KONTEN[kontenrahmen];
  if (liste.bis1.includes(account)) return "bis1";
  if (liste.ueber1.includes(account)) return "ueber1";
  return null;
}

export function istGesellschafterKonto(kontenrahmen: Kontenrahmen, account: string): boolean {
  return GESELLSCHAFTER_KONTEN[kontenrahmen].some(([von, bis]) => account >= von && account <= bis);
}

/** Ein Konto mit Vermerk: Anlagevermögen (nur Gesellschafter), Forderungen im Umlaufvermögen, Verbindlichkeiten */
export interface VermerkKonto {
  account: string;
  posten: Extract<BilanzPosten, "aktiva.A" | "aktiva.B" | "passiva.C">;
  /** Saldo Soll − Haben */
  saldo: Cents;
  /** Betrag im Posten, positiv auf seiner Seite; negativ, wo ein Konto den Posten mindert (Wertberichtigungen) */
  betrag: Cents;
  gesellschafter: boolean;
}

const FORDERUNG = "bs.ass.currAss.receiv.";

/** Konten des Abschlusses, die einen Vermerk tragen können */
export function vermerkKonten(kontenrahmen: Kontenrahmen, report: Abschluss): VermerkKonto[] {
  const result: VermerkKonto[] = [];
  for (const posten of ["aktiva.A", "aktiva.B", "passiva.C"] as const) {
    for (const { account, saldo } of report.konten[posten] ?? []) {
      const gesellschafter = istGesellschafterKonto(kontenrahmen, account);
      // Im Umlaufvermögen nur Forderungen und sonstige Vermögensgegenstände, nicht Kasse, Bank oder Vorräte
      if (posten === "aktiva.A" && !gesellschafter) continue;
      if (posten === "aktiva.B" && !ebilanzPosition(kontenrahmen, account, saldo)?.startsWith(FORDERUNG)) continue;
      result.push({ account, posten, saldo, betrag: posten === "passiva.C" ? -saldo : saldo, gesellschafter });
    }
  }
  return result;
}

/** Restlaufzeit je Konto, wie die Nutzerin sie zum Stichtag bestätigt hat */
export interface RestlaufzeitAngabe {
  account: string;
  /** Betrag im Posten beim Bestätigen; ändert er sich, ist die Angabe neu zu bestätigen */
  betrag: Cents;
  /** Davon Restlaufzeit von mehr als einem Jahr */
  ueber1Jahr: Cents;
}

export interface RestlaufzeitZeile {
  account: string;
  art: "forderung" | "verbindlichkeit";
  betrag: Cents;
  /** Laut Konto oder Vorzeichen festgelegt; dann gibt es nichts einzugeben */
  eingabe: boolean;
  /** Vorschlag bzw. fester Wert für den Teil mit mehr als einem Jahr */
  vorschlag: Cents;
  grund: string;
}

/** Offene Rechnungen bzw. Belege zum Stichtag, die erst mehr als ein Jahr danach fällig sind */
export interface SpaetFaellig {
  forderungen: Cents;
  verbindlichkeiten: Cents;
}

/**
 * Konten für die Angabe der Restlaufzeiten zum 31.12. des Jahres, je mit Vorschlag. Fest sind Konten, deren Name die
 * Restlaufzeit nennt, und Konten, die den Posten mindern. Forderungen und Verbindlichkeiten aus Lieferungen und
 * Leistungen schlägt Haben aus der Fälligkeit offener Rechnungen und Belege vor; für alles andere gibt es in Haben keine
 * Laufzeit, ohne Vereinbarung ist es sofort fällig (§ 271 Abs. 1 BGB).
 */
export function restlaufzeitZeilen(kontenrahmen: Kontenrahmen, year: number, report: Abschluss, spaet: SpaetFaellig): RestlaufzeitZeile[] {
  const a = ACCOUNTS[kontenrahmen];
  const grenze = `31.12.${year + 1}`;
  return vermerkKonten(kontenrahmen, report)
    .filter((k) => k.posten !== "aktiva.A")
    .map((k): RestlaufzeitZeile => {
      const art = k.posten === "aktiva.B" ? "forderung" : "verbindlichkeit";
      const zeile = (eingabe: boolean, vorschlag: Cents, grund: string): RestlaufzeitZeile => ({
        account: k.account,
        art,
        betrag: k.betrag,
        eingabe,
        vorschlag,
        grund,
      });
      const laut = restlaufzeitLautKonto(kontenrahmen, k.account);
      if (laut === "bis1") return zeile(false, 0, "Das Konto führt Beträge mit einer Restlaufzeit bis zu einem Jahr.");
      if (laut === "ueber1") return zeile(false, k.betrag, "Das Konto führt Beträge mit einer Restlaufzeit von mehr als einem Jahr.");
      if (k.betrag <= 0) return zeile(false, 0, "Der Saldo steht auf der Gegenseite und mindert den Posten.");
      if (k.account === a.forderungen) {
        const wert = Math.min(spaet.forderungen, k.betrag);
        return zeile(
          true,
          wert,
          wert > 0 ? `Offene Rechnungen, die erst nach dem ${grenze} fällig sind.` : `Alle offenen Rechnungen sind bis zum ${grenze} fällig.`,
        );
      }
      if (k.account === a.verbindlichkeiten) {
        const wert = Math.min(spaet.verbindlichkeiten, k.betrag);
        return zeile(true, wert, wert > 0 ? `Offene Belege, die erst nach dem ${grenze} fällig sind.` : `Alle offenen Belege sind bis zum ${grenze} fällig.`);
      }
      return zeile(
        true,
        0,
        `Ohne vereinbarte Laufzeit sofort fällig (§ 271 Abs. 1 BGB). Bei einem Darlehen oder einer Ratenzahlung den Teil eintragen, der erst nach dem ${grenze} fällig ist.`,
      );
    });
}

export type RestlaufzeitStand = "keine" | "fehlt" | "geaendert" | "bestaetigt";

/**
 * Gleicht die gespeicherten Angaben mit den Konten zum Stichtag ab. Bestätigt ist, wenn jedes Konto mit Eingabe mit
 * demselben Betrag gespeichert ist; feste Konten brauchen keine Angabe. Liefert den Teil über einem Jahr je Konto.
 */
export function restlaufzeitAbgleich(
  zeilen: readonly RestlaufzeitZeile[],
  gespeichert: readonly RestlaufzeitAngabe[] | null,
): { stand: RestlaufzeitStand; ueber1Jahr: Map<string, Cents> } {
  const ueber1Jahr = new Map(zeilen.filter((z) => !z.eingabe).map((z) => [z.account, z.vorschlag]));
  const offen = zeilen.filter((z) => z.eingabe);
  if (offen.length === 0) return { stand: zeilen.length === 0 ? "keine" : "bestaetigt", ueber1Jahr };
  if (!gespeichert) return { stand: "fehlt", ueber1Jahr };
  for (const z of offen) {
    const angabe = gespeichert.find((g) => g.account === z.account);
    if (!angabe || angabe.betrag !== z.betrag || angabe.ueber1Jahr < 0 || angabe.ueber1Jahr > z.betrag) return { stand: "geaendert", ueber1Jahr };
    ueber1Jahr.set(z.account, angabe.ueber1Jahr);
  }
  return { stand: "bestaetigt", ueber1Jahr };
}

export interface BilanzVermerk {
  posten: BilanzPosten;
  label: string;
  betrag: Cents;
}

export const VERMERK = {
  ausleihungenGesellschafter: "davon Ausleihungen an Gesellschafter",
  forderungenUeber1Jahr: "davon Forderungen mit einer Restlaufzeit von mehr als einem Jahr",
  forderungenGesellschafter: "davon Forderungen gegen Gesellschafter",
  verbindlichkeitenBis1Jahr: "davon mit einer Restlaufzeit bis zu einem Jahr",
  verbindlichkeitenUeber1Jahr: "davon mit einer Restlaufzeit von mehr als einem Jahr",
  verbindlichkeitenGesellschafter: "davon gegenüber Gesellschaftern",
} as const;

/**
 * Die Vermerke zu einem Stichtag. Restlaufzeiten nur mit bestätigten Angaben (ueber1Jahr), sonst fehlen sie. Ein Vermerk
 * mit 0 entfällt; bei den Verbindlichkeiten stehen beide Restlaufzeiten, sobald es Verbindlichkeiten gibt.
 */
export function bilanzVermerke(konten: readonly VermerkKonto[], ueber1Jahr: ReadonlyMap<string, Cents> | null): BilanzVermerk[] {
  const summe = (filter: (k: VermerkKonto) => boolean, wert: (k: VermerkKonto) => Cents = (k) => k.betrag) =>
    konten.filter(filter).reduce((s, k) => s + wert(k), 0);
  const ueber = (k: VermerkKonto) => ueber1Jahr?.get(k.account) ?? 0;
  const verbindlichkeiten = summe((k) => k.posten === "passiva.C");
  const vermerke: BilanzVermerk[] = [
    { posten: "aktiva.A", label: VERMERK.ausleihungenGesellschafter, betrag: summe((k) => k.posten === "aktiva.A") },
    ...(ueber1Jahr ? [{ posten: "aktiva.B" as const, label: VERMERK.forderungenUeber1Jahr, betrag: summe((k) => k.posten === "aktiva.B", ueber) }] : []),
    { posten: "aktiva.B", label: VERMERK.forderungenGesellschafter, betrag: summe((k) => k.posten === "aktiva.B" && k.gesellschafter) },
  ];
  const rlz: BilanzVermerk[] = [];
  if (ueber1Jahr && verbindlichkeiten !== 0) {
    const lang = summe((k) => k.posten === "passiva.C", ueber);
    rlz.push(
      { posten: "passiva.C", label: VERMERK.verbindlichkeitenBis1Jahr, betrag: verbindlichkeiten - lang },
      { posten: "passiva.C", label: VERMERK.verbindlichkeitenUeber1Jahr, betrag: lang },
    );
  }
  return [
    ...vermerke.filter((v) => v.betrag !== 0),
    ...rlz,
    ...[
      { posten: "passiva.C" as const, label: VERMERK.verbindlichkeitenGesellschafter, betrag: summe((k) => k.posten === "passiva.C" && k.gesellschafter) },
    ].filter((v) => v.betrag !== 0),
  ];
}

/**
 * Davon-Positionen der E-Bilanz (HGB-Taxonomie 6.9) aus den bestätigten Restlaufzeiten: je Gruppe der Forderungen bzw.
 * Verbindlichkeiten (etwa bs.eqLiab.liab.bank) .upTo1year und .above1year, dazu die Summen bs.ass.currAss.receiv.above1year,
 * bs.eqLiab.liab.upTo1year und bs.eqLiab.liab.above1year. Die Gruppe ist die der Position, auf der das Konto steht.
 */
export function ebilanzRestlaufzeiten(
  kontenrahmen: Kontenrahmen,
  konten: readonly VermerkKonto[],
  ueber1Jahr: ReadonlyMap<string, Cents>,
): Record<string, Cents> {
  const werte: Record<string, Cents> = {};
  const add = (position: string, wert: Cents) => {
    werte[position] = (werte[position] ?? 0) + wert;
  };
  for (const k of konten) {
    if (k.posten === "aktiva.A") continue;
    const position = ebilanzPosition(kontenrahmen, k.account, k.saldo);
    const teile = position?.split(".") ?? [];
    const forderung = position?.startsWith(FORDERUNG) ?? false;
    if (!forderung && !position?.startsWith("bs.eqLiab.liab.")) continue;
    const gruppe = teile.slice(0, forderung ? 5 : 4).join(".");
    const lang = ueber1Jahr.get(k.account) ?? 0;
    add(`${gruppe}.upTo1year`, k.betrag - lang);
    add(`${gruppe}.above1year`, lang);
    if (forderung) add("bs.ass.currAss.receiv.above1year", lang);
    else {
      add("bs.eqLiab.liab.upTo1year", k.betrag - lang);
      add("bs.eqLiab.liab.above1year", lang);
    }
  }
  return Object.fromEntries(Object.entries(werte).filter(([, wert]) => wert !== 0));
}
