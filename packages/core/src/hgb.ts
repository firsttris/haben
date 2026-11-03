import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";
import { carriesForward } from "./vortrag.ts";

/*
 * Jahresabschluss einer Kleinstkapitalgesellschaft (§ 267a HGB): verkürzte Bilanz nur mit den Posten, die in § 266 Abs. 2
 * und 3 HGB Buchstaben tragen (§ 266 Abs. 1 Satz 4), und die GuV nach § 275 Abs. 5 HGB.
 *
 * ENTWURF: Die Zuordnung der Konten folgt den Bilanz- und GuV-Posten, die die DATEV-Kontenrahmen den Konten geben, so wie
 * odoo l10n_de sie je Konto führt (Posten nach § 266 und § 275 Abs. 2, hier auf die Ebene des § 267a verdichtet). Sie ist
 * noch nicht gegen den DATEV-Kontenrahmen selbst geprüft; einzelne Konten sind umstritten (etwa „Umsatzsteuer nicht fällig“,
 * dort als Steuerrückstellung). Bis dahin zeigt Haben Bilanz und GuV als Entwurf für die Steuerberatung.
 */

export type BilanzPosten = "aktiva.A" | "aktiva.B" | "aktiva.C" | "aktiva.D" | "aktiva.E" | "passiva.A" | "passiva.B" | "passiva.C" | "passiva.D" | "passiva.E";
export type GuvPosten = "umsatzerloese" | "sonstigeErtraege" | "materialaufwand" | "personalaufwand" | "abschreibungen" | "sonstigeAufwendungen" | "steuern";
export type Posten = BilanzPosten | GuvPosten;

export const BILANZ_POSTEN: Record<BilanzPosten, string> = {
  "aktiva.A": "A. Anlagevermögen",
  "aktiva.B": "B. Umlaufvermögen",
  "aktiva.C": "C. Rechnungsabgrenzungsposten",
  "aktiva.D": "D. Aktive latente Steuern",
  "aktiva.E": "E. Aktiver Unterschiedsbetrag aus der Vermögensverrechnung",
  "passiva.A": "A. Eigenkapital",
  "passiva.B": "B. Rückstellungen",
  "passiva.C": "C. Verbindlichkeiten",
  "passiva.D": "D. Rechnungsabgrenzungsposten",
  "passiva.E": "E. Passive latente Steuern",
};

/** § 275 Abs. 5 HGB, Nr. 1 bis 7; Nr. 8 ist das Ergebnis */
export const GUV_POSTEN: Record<GuvPosten, string> = {
  umsatzerloese: "1. Umsatzerlöse",
  sonstigeErtraege: "2. Sonstige Erträge",
  materialaufwand: "3. Materialaufwand",
  personalaufwand: "4. Personalaufwand",
  abschreibungen: "5. Abschreibungen",
  sonstigeAufwendungen: "6. Sonstige Aufwendungen",
  steuern: "7. Steuern",
};

/** Kontenbereiche [von, bis, Posten], aufsteigend; Konten dazwischen sind keinem Posten zugeordnet */
const BEREICHE: Record<Kontenrahmen, readonly (readonly [string, string, Posten])[]> = {
  SKR03: [
    ["0005", "0595", "aktiva.A"],
    ["0600", "0799", "passiva.C"],
    ["0800", "0819", "passiva.A"],
    ["0839", "0839", "aktiva.B"],
    ["0845", "0920", "passiva.A"],
    ["0950", "0967", "passiva.B"],
    ["0968", "0968", "passiva.E"],
    ["0969", "0979", "passiva.B"],
    ["0980", "0980", "aktiva.C"],
    ["0983", "0983", "aktiva.D"],
    ["0984", "0986", "aktiva.C"],
    ["0987", "0989", "passiva.A"],
    ["0990", "0990", "passiva.D"],
    ["0996", "1353", "aktiva.B"],
    ["1354", "1354", "aktiva.E"],
    ["1355", "1356", "aktiva.B"],
    ["1357", "1357", "aktiva.E"],
    // Nicht in odoo l10n_de: 1360 Geldtransit und die Verrechnungskonten der Zahlungsdienstleister (1361–1369) sind Finanzkonten
    ["1358", "1369", "aktiva.B"],
    ["1370", "1599", "aktiva.B"],
    ["1600", "1722", "passiva.C"],
    ["1725", "1729", "aktiva.B"],
    ["1730", "1754", "passiva.C"],
    ["1755", "1758", "aktiva.B"],
    ["1759", "1759", "passiva.C"],
    ["1760", "1766", "passiva.B"],
    ["1767", "1787", "aktiva.B"],
    ["1788", "1791", "passiva.C"],
    ["1792", "1793", "aktiva.B"],
    ["1794", "1797", "passiva.C"],
    ["1800", "1990", "passiva.A"],
    ["2000", "2176", "sonstigeAufwendungen"],
    ["2200", "2255", "steuern"],
    ["2260", "2260", "sonstigeAufwendungen"],
    ["2265", "2265", "sonstigeErtraege"],
    ["2280", "2289", "steuern"],
    ["2300", "2313", "sonstigeAufwendungen"],
    ["2315", "2318", "sonstigeErtraege"],
    ["2320", "2350", "sonstigeAufwendungen"],
    ["2375", "2375", "steuern"],
    ["2380", "2501", "sonstigeAufwendungen"],
    ["2504", "2990", "sonstigeErtraege"],
    ["3000", "3110", "materialaufwand"],
    ["3113", "3113", "sonstigeAufwendungen"],
    ["3115", "3120", "materialaufwand"],
    ["3123", "3123", "sonstigeAufwendungen"],
    ["3125", "3145", "materialaufwand"],
    ["3150", "3185", "sonstigeAufwendungen"],
    ["3200", "3960", "materialaufwand"],
    ["3970", "3980", "aktiva.B"],
    ["4100", "4138", "personalaufwand"],
    ["4139", "4139", "sonstigeAufwendungen"],
    ["4140", "4199", "personalaufwand"],
    ["4200", "4306", "sonstigeAufwendungen"],
    ["4320", "4355", "steuern"],
    ["4360", "4500", "sonstigeAufwendungen"],
    ["4510", "4510", "steuern"],
    ["4520", "4631", "sonstigeAufwendungen"],
    ["4632", "4633", "steuern"],
    ["4635", "4810", "sonstigeAufwendungen"],
    ["4815", "4893", "abschreibungen"],
    ["4900", "4999", "sonstigeAufwendungen"],
    ["7000", "7200", "aktiva.B"],
    ["8100", "8589", "umsatzerloese"],
    ["8590", "8660", "sonstigeErtraege"],
    ["8700", "8790", "umsatzerloese"],
    ["8800", "8819", "sonstigeAufwendungen"],
    ["8820", "8853", "sonstigeErtraege"],
    ["8900", "8919", "umsatzerloese"],
    ["8920", "8939", "sonstigeErtraege"],
    ["8940", "8959", "umsatzerloese"],
    ["8960", "8995", "sonstigeErtraege"],
  ],
  SKR04: [
    ["0050", "0090", "aktiva.B"],
    ["0100", "0980", "aktiva.A"],
    ["1000", "1380", "aktiva.B"],
    ["1381", "1381", "aktiva.E"],
    ["1382", "1382", "aktiva.B"],
    ["1383", "1383", "aktiva.E"],
    ["1390", "1490", "aktiva.B"],
    ["1495", "1495", "passiva.C"],
    ["1498", "1498", "personalaufwand"],
    ["1500", "1890", "aktiva.B"],
    ["1900", "1950", "aktiva.C"],
    ["2000", "2979", "passiva.A"],
    ["3000", "3060", "passiva.B"],
    ["3065", "3065", "passiva.E"],
    ["3070", "3099", "passiva.B"],
    ["3100", "3620", "passiva.C"],
    ["3630", "3635", "aktiva.B"],
    ["3640", "3658", "passiva.C"],
    ["3695", "3695", "aktiva.B"],
    ["3700", "3786", "passiva.C"],
    ["3790", "3790", "aktiva.B"],
    ["3796", "3796", "passiva.C"],
    ["3798", "3809", "aktiva.B"],
    ["3810", "3816", "passiva.B"],
    ["3817", "3837", "aktiva.B"],
    ["3840", "3850", "passiva.C"],
    ["3851", "3851", "aktiva.B"],
    ["3854", "3865", "passiva.C"],
    ["3900", "3950", "passiva.D"],
    ["4000", "4569", "umsatzerloese"],
    ["4570", "4579", "sonstigeErtraege"],
    ["4600", "4620", "umsatzerloese"],
    ["4630", "4660", "sonstigeErtraege"],
    ["4670", "4680", "umsatzerloese"],
    ["4686", "4689", "sonstigeErtraege"],
    ["4690", "4790", "umsatzerloese"],
    ["4800", "4992", "sonstigeErtraege"],
    ["5000", "5910", "materialaufwand"],
    ["5913", "5913", "sonstigeAufwendungen"],
    ["5915", "5920", "materialaufwand"],
    ["5923", "5923", "sonstigeAufwendungen"],
    ["5925", "5925", "materialaufwand"],
    ["5950", "5985", "sonstigeAufwendungen"],
    ["6000", "6171", "personalaufwand"],
    ["6200", "6280", "abschreibungen"],
    ["6281", "6286", "sonstigeAufwendungen"],
    ["6290", "6291", "abschreibungen"],
    ["6300", "6969", "sonstigeAufwendungen"],
    ["7000", "7194", "sonstigeErtraege"],
    ["7200", "7255", "abschreibungen"],
    ["7300", "7320", "sonstigeAufwendungen"],
    ["7323", "7324", "abschreibungen"],
    ["7325", "7399", "sonstigeAufwendungen"],
    ["7400", "7464", "sonstigeErtraege"],
    ["7500", "7563", "sonstigeAufwendungen"],
    ["7600", "7785", "steuern"],
  ],
};

/** Posten eines Kontos nach seinem Kontenbereich; null = nicht zugeordnet (Klasse 9, Lücken) */
export function postenOf(kontenrahmen: Kontenrahmen, account: string): Posten | null {
  if (!/^\d{4}$/.test(account)) return null;
  for (const [von, bis, posten] of BEREICHE[kontenrahmen]) {
    if (account >= von && account <= bis) return posten;
    if (account < von) return null;
  }
  return null;
}

export interface AbschlussSaldo {
  account: string;
  /** Saldo zum Stichtag, Soll − Haben; bei Erfolgskonten nur das Jahr */
  saldo: Cents;
}

export interface AbschlussKonto {
  account: string;
  saldo: Cents;
}

export interface Abschluss {
  /** Beträge positiv auf ihrer Seite: Aktiva mit Soll-, Passiva mit Haben-Saldo; Jahresergebnis im Eigenkapital enthalten */
  bilanz: Record<BilanzPosten, Cents>;
  /** Erträge positiv, Aufwendungen positiv als Aufwand */
  guv: Record<GuvPosten, Cents>;
  /** Jahresüberschuss (positiv) oder Jahresfehlbetrag (negativ), § 275 Abs. 5 Nr. 8 */
  jahresergebnis: Cents;
  aktiva: Cents;
  passiva: Cents;
  /** Konten je Posten, für die Aufschlüsselung */
  konten: Partial<Record<Posten, AbschlussKonto[]>>;
  /** Konten ohne Posten (außer 9000 mit Saldo 0) */
  nichtZugeordnet: AbschlussKonto[];
  /** 9000 Saldenvorträge und andere Klasse-9-Konten mit Saldo: die Eröffnung ist nicht ausgeglichen */
  offeneVortraege: AbschlussKonto[];
}

const emptyBilanz = (): Record<BilanzPosten, Cents> => ({
  "aktiva.A": 0,
  "aktiva.B": 0,
  "aktiva.C": 0,
  "aktiva.D": 0,
  "aktiva.E": 0,
  "passiva.A": 0,
  "passiva.B": 0,
  "passiva.C": 0,
  "passiva.D": 0,
  "passiva.E": 0,
});

const emptyGuv = (): Record<GuvPosten, Cents> => ({
  umsatzerloese: 0,
  sonstigeErtraege: 0,
  materialaufwand: 0,
  personalaufwand: 0,
  abschreibungen: 0,
  sonstigeAufwendungen: 0,
  steuern: 0,
});

const isBilanz = (posten: Posten): posten is BilanzPosten => posten.startsWith("aktiva.") || posten.startsWith("passiva.");
const ERTRAG: readonly GuvPosten[] = ["umsatzerloese", "sonstigeErtraege"];

/**
 * Bilanz und GuV aus den Salden zum Stichtag. Ein Konto des Umlaufvermögens mit Haben-Saldo (überzogene Bank) steht unter
 * den Verbindlichkeiten, eine Verbindlichkeit mit Soll-Saldo (Gesellschafter schuldet der GmbH) im Umlaufvermögen; sonst
 * gilt der Posten des Kontenbereichs. Das Jahresergebnis kommt aus der GuV und steht im Eigenkapital.
 */
export function abschluss(kontenrahmen: Kontenrahmen, salden: readonly AbschlussSaldo[]): Abschluss {
  const bilanz = emptyBilanz();
  const guv = emptyGuv();
  const konten: Partial<Record<Posten, AbschlussKonto[]>> = {};
  const nichtZugeordnet: AbschlussKonto[] = [];
  const offeneVortraege: AbschlussKonto[] = [];
  const add = (posten: Posten, konto: AbschlussKonto) => {
    konten[posten] = [...(konten[posten] ?? []), konto];
  };
  for (const { account, saldo } of salden) {
    if (saldo === 0) continue;
    if (account.startsWith("9")) {
      offeneVortraege.push({ account, saldo });
      continue;
    }
    let posten = postenOf(kontenrahmen, account);
    if (posten === null || isBilanz(posten) !== carriesForward(kontenrahmen, account)) {
      nichtZugeordnet.push({ account, saldo });
      continue;
    }
    if (posten === "aktiva.B" && saldo < 0) posten = "passiva.C";
    else if (posten === "passiva.C" && saldo > 0) posten = "aktiva.B";
    add(posten, { account, saldo });
    if (isBilanz(posten)) bilanz[posten] += posten.startsWith("aktiva.") ? saldo : -saldo;
    else guv[posten] += ERTRAG.includes(posten) ? -saldo : saldo;
  }
  const ertraege = ERTRAG.reduce((s, p) => s + guv[p], 0);
  const aufwand = (Object.keys(guv) as GuvPosten[]).filter((p) => !ERTRAG.includes(p)).reduce((s, p) => s + guv[p], 0);
  const jahresergebnis = ertraege - aufwand;
  bilanz["passiva.A"] += jahresergebnis;
  const sum = (side: "aktiva" | "passiva") => (Object.keys(bilanz) as BilanzPosten[]).filter((p) => p.startsWith(side)).reduce((s, p) => s + bilanz[p], 0);
  return { bilanz, guv, jahresergebnis, aktiva: sum("aktiva"), passiva: sum("passiva"), konten, nichtZugeordnet, offeneVortraege };
}
