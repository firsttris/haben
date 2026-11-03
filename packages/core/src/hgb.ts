import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";
import { carriesForward } from "./vortrag.ts";

/*
 * Jahresabschluss einer Kleinstkapitalgesellschaft (§ 267a HGB): verkürzte Bilanz nur mit den Posten, die in § 266 Abs. 2
 * und 3 HGB Buchstaben tragen (§ 266 Abs. 1 Satz 4), und die GuV nach § 275 Abs. 5 HGB.
 *
 * Die Zuordnung der Konten (BEREICHE) stammt aus dem DATEV-Kontenrahmen selbst. Haben zeigt Bilanz und GuV trotzdem als
 * Entwurf für die Steuerberatung: Abschlussbuchungen (Rückstellungen, Abgrenzungen, Steuern) und Bewertung macht sie.
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

/**
 * Kontenbereiche [von, bis, Posten, Posten bei umgekehrtem Saldo], aufsteigend. Erzeugt aus den Bilanz- und GuV-Posten des
 * DATEV-Kontenrahmens 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175, „Kontenrahmen nach dem
 * Bilanzrichtlinie-Umsetzungsgesetz“): je Konto der Posten der linken Spalte, verdichtet auf § 267a HGB; „A oder B“ dort ist
 * der Posten bei Soll- bzw. Haben-Saldo. Konten zwischen zwei Bereichen haben keinen Posten, ebenso Sonderposten und die
 * Konten der Ergebnisverwendung nach dem Jahresergebnis (§ 158 AktG); sie erscheinen im Abschluss als nicht zugeordnet.
 */
type Bereich = readonly [von: string, bis: string, posten: Posten, umgekehrt?: Posten];

const BEREICHE: Record<Kontenrahmen, readonly Bereich[]> = {
  SKR03: [
    ["0005", "0005", "aktiva.B"],
    ["0010", "0035", "aktiva.A"],
    ["0038", "0039", "aktiva.B"],
    ["0040", "0595", "aktiva.A"],
    ["0600", "0625", "passiva.C"],
    ["0630", "0690", "passiva.C", "aktiva.B"],
    ["0699", "0699", "passiva.C"],
    ["0700", "0730", "passiva.C", "aktiva.B"],
    ["0731", "0799", "passiva.C"],
    ["0800", "0829", "passiva.A"],
    ["0830", "0839", "aktiva.B"],
    ["0840", "0881", "passiva.A"],
    ["0890", "0899", "passiva.C", "aktiva.B"],
    ["0900", "0919", "passiva.A"],
    ["0920", "0929", "passiva.C", "aktiva.B"],
    ["0950", "0950", "passiva.B"],
    ["0951", "0951", "passiva.B", "aktiva.E"],
    ["0952", "0966", "passiva.B"],
    ["0967", "0967", "passiva.B", "aktiva.E"],
    ["0968", "0968", "passiva.E"],
    ["0969", "0979", "passiva.B"],
    ["0980", "0980", "aktiva.C"],
    ["0983", "0983", "aktiva.D"],
    ["0984", "0986", "aktiva.C"],
    ["0987", "0989", "passiva.A"],
    ["0990", "0992", "passiva.D"],
    ["0996", "1020", "aktiva.B"],
    ["1100", "1290", "aktiva.B", "passiva.C"],
    ["1295", "1295", "passiva.C", "aktiva.B"],
    ["1300", "1328", "aktiva.B", "passiva.C"],
    ["1329", "1353", "aktiva.B"],
    ["1354", "1354", "aktiva.E", "passiva.B"],
    ["1355", "1356", "aktiva.B"],
    ["1357", "1357", "aktiva.E", "passiva.B"],
    ["1360", "1375", "aktiva.B", "passiva.C"],
    ["1376", "1379", "aktiva.B"],
    ["1380", "1475", "aktiva.B", "passiva.C"],
    ["1478", "1479", "aktiva.B"],
    ["1480", "1485", "aktiva.B", "passiva.C"],
    ["1488", "1489", "aktiva.B"],
    ["1490", "1495", "aktiva.B", "passiva.C"],
    ["1498", "1498", "aktiva.B"],
    ["1499", "1501", "aktiva.B", "passiva.C"],
    ["1502", "1502", "aktiva.B"],
    ["1503", "1503", "aktiva.B", "passiva.C"],
    ["1504", "1504", "aktiva.B"],
    ["1505", "1505", "aktiva.B", "passiva.C"],
    ["1506", "1506", "aktiva.B"],
    ["1507", "1508", "aktiva.B", "passiva.C"],
    ["1510", "1518", "aktiva.B"],
    ["1519", "1521", "aktiva.B", "passiva.C"],
    ["1522", "1527", "aktiva.B"],
    ["1528", "1529", "aktiva.B", "passiva.C"],
    ["1530", "1537", "aktiva.B"],
    ["1539", "1540", "aktiva.B", "passiva.C"],
    ["1542", "1543", "aktiva.B"],
    ["1544", "1544", "aktiva.B", "passiva.C"],
    ["1545", "1545", "aktiva.B"],
    ["1546", "1549", "aktiva.B", "passiva.C"],
    ["1550", "1555", "aktiva.B"],
    ["1556", "1592", "aktiva.B", "passiva.C"],
    ["1593", "1593", "passiva.C", "aktiva.B"],
    ["1594", "1599", "aktiva.B", "passiva.C"],
    ["1600", "1659", "passiva.C", "aktiva.B"],
    ["1660", "1664", "passiva.C"],
    ["1665", "1666", "passiva.C", "aktiva.B"],
    ["1667", "1668", "passiva.C"],
    ["1670", "1693", "passiva.C", "aktiva.B"],
    ["1695", "1698", "passiva.C"],
    ["1700", "1701", "passiva.C", "aktiva.B"],
    ["1702", "1708", "passiva.C"],
    ["1709", "1709", "passiva.C", "aktiva.B"],
    ["1710", "1722", "passiva.C"],
    ["1725", "1725", "passiva.C", "aktiva.B"],
    ["1728", "1729", "passiva.C"],
    ["1730", "1731", "passiva.C", "aktiva.B"],
    ["1732", "1735", "passiva.C"],
    ["1736", "1737", "passiva.C", "aktiva.B"],
    ["1738", "1739", "passiva.C"],
    ["1740", "1751", "passiva.C", "aktiva.B"],
    ["1752", "1754", "passiva.C"],
    ["1755", "1757", "passiva.C", "aktiva.B"],
    ["1758", "1758", "passiva.C"],
    ["1759", "1759", "passiva.C", "aktiva.B"],
    ["1760", "1766", "passiva.B", "aktiva.B"],
    ["1767", "1768", "passiva.C"],
    ["1769", "1792", "passiva.C", "aktiva.B"],
    ["1793", "1793", "aktiva.B"],
    ["1794", "1795", "passiva.C", "aktiva.B"],
    ["1796", "1798", "passiva.C"],
    ["1800", "1891", "passiva.A"],
    ["1900", "1999", "passiva.C", "aktiva.B"],
    ["2004", "2145", "sonstigeAufwendungen"],
    ["2146", "2147", "sonstigeAufwendungen", "sonstigeErtraege"],
    ["2148", "2176", "sonstigeAufwendungen"],
    ["2200", "2289", "steuern"],
    ["2300", "2313", "sonstigeAufwendungen"],
    ["2315", "2318", "sonstigeErtraege"],
    ["2320", "2350", "sonstigeAufwendungen"],
    ["2375", "2375", "steuern"],
    ["2380", "2409", "sonstigeAufwendungen"],
    ["2430", "2441", "abschreibungen"],
    ["2450", "2490", "sonstigeAufwendungen"],
    ["2491", "2685", "sonstigeErtraege"],
    ["2686", "2687", "sonstigeErtraege", "sonstigeAufwendungen"],
    ["2689", "2749", "sonstigeErtraege"],
    ["2750", "2754", "umsatzerloese"],
    ["2760", "2762", "sonstigeErtraege"],
    ["2764", "2764", "umsatzerloese"],
    ["2790", "2794", "sonstigeErtraege"],
    ["2890", "2900", "sonstigeAufwendungen"],
    ["3000", "3969", "materialaufwand"],
    ["3970", "3989", "aktiva.B"],
    ["3990", "4099", "materialaufwand"],
    ["4100", "4138", "personalaufwand"],
    ["4139", "4139", "sonstigeAufwendungen"],
    ["4140", "4199", "personalaufwand"],
    ["4200", "4306", "sonstigeAufwendungen"],
    ["4320", "4355", "steuern"],
    ["4360", "4500", "sonstigeAufwendungen"],
    ["4510", "4510", "steuern"],
    ["4520", "4810", "sonstigeAufwendungen"],
    ["4815", "4882", "abschreibungen"],
    ["4886", "4887", "sonstigeAufwendungen"],
    ["4892", "4893", "abschreibungen"],
    ["4900", "6000", "sonstigeAufwendungen"],
    ["7000", "7140", "aktiva.B"],
    ["8000", "8589", "umsatzerloese"],
    ["8590", "8606", "sonstigeErtraege"],
    ["8607", "8607", "umsatzerloese"],
    ["8609", "8660", "sonstigeErtraege"],
    ["8700", "8799", "umsatzerloese"],
    ["8800", "8819", "sonstigeAufwendungen"],
    ["8820", "8949", "sonstigeErtraege"],
    ["8950", "8959", "umsatzerloese"],
    ["8960", "8995", "sonstigeErtraege"],
  ],
  SKR04: [
    ["0050", "0059", "passiva.A"],
    ["0060", "0069", "aktiva.B"],
    ["0070", "0079", "passiva.A"],
    ["0080", "0090", "aktiva.B"],
    ["0100", "0169", "aktiva.A"],
    ["0170", "0179", "aktiva.B"],
    ["0200", "0990", "aktiva.A"],
    ["1000", "1186", "aktiva.B"],
    ["1190", "1190", "passiva.C"],
    ["1200", "1245", "aktiva.B", "passiva.C"],
    ["1246", "1249", "aktiva.B"],
    ["1250", "1255", "aktiva.B", "passiva.C"],
    ["1258", "1258", "aktiva.B"],
    ["1259", "1275", "aktiva.B", "passiva.C"],
    ["1276", "1277", "aktiva.B"],
    ["1280", "1295", "aktiva.B", "passiva.C"],
    ["1296", "1299", "aktiva.B"],
    ["1300", "1301", "aktiva.B", "passiva.C"],
    ["1305", "1305", "aktiva.B"],
    ["1307", "1309", "aktiva.B", "passiva.C"],
    ["1310", "1315", "aktiva.B"],
    ["1317", "1321", "aktiva.B", "passiva.C"],
    ["1325", "1325", "aktiva.B"],
    ["1327", "1335", "aktiva.B", "passiva.C"],
    ["1337", "1365", "aktiva.B"],
    ["1369", "1377", "aktiva.B", "passiva.C"],
    ["1378", "1380", "aktiva.B"],
    ["1381", "1381", "aktiva.E", "passiva.B"],
    ["1382", "1382", "aktiva.B"],
    ["1383", "1383", "aktiva.E", "passiva.B"],
    ["1390", "1390", "aktiva.B"],
    ["1391", "1391", "aktiva.B", "passiva.C"],
    ["1393", "1395", "aktiva.B"],
    ["1396", "1419", "aktiva.B", "passiva.C"],
    ["1420", "1420", "aktiva.B"],
    ["1422", "1436", "aktiva.B", "passiva.C"],
    ["1440", "1440", "aktiva.B"],
    ["1450", "1450", "aktiva.B", "passiva.C"],
    ["1456", "1456", "aktiva.B"],
    ["1457", "1494", "aktiva.B", "passiva.C"],
    ["1495", "1497", "passiva.C", "aktiva.B"],
    ["1498", "1498", "aktiva.B", "passiva.C"],
    ["1500", "1620", "aktiva.B"],
    ["1700", "1890", "aktiva.B", "passiva.C"],
    ["1895", "1895", "passiva.C", "aktiva.B"],
    ["1900", "1940", "aktiva.C"],
    ["1950", "1950", "aktiva.D"],
    ["2000", "2011", "passiva.A"],
    ["2020", "2049", "passiva.C", "aktiva.B"],
    ["2050", "2069", "passiva.A"],
    ["2070", "2099", "passiva.C", "aktiva.B"],
    ["2100", "2399", "passiva.A"],
    ["2500", "2799", "passiva.C", "aktiva.B"],
    ["2900", "2978", "passiva.A"],
    ["3000", "3005", "passiva.B"],
    ["3009", "3009", "passiva.B", "aktiva.E"],
    ["3010", "3060", "passiva.B"],
    ["3065", "3065", "passiva.E"],
    ["3070", "3076", "passiva.B"],
    ["3077", "3077", "passiva.B", "aktiva.E"],
    ["3079", "3099", "passiva.B"],
    ["3100", "3130", "passiva.C"],
    ["3150", "3210", "passiva.C", "aktiva.B"],
    ["3249", "3285", "passiva.C"],
    ["3300", "3349", "passiva.C", "aktiva.B"],
    ["3350", "3399", "passiva.C"],
    ["3400", "3501", "passiva.C", "aktiva.B"],
    ["3504", "3509", "passiva.C"],
    ["3510", "3511", "passiva.C", "aktiva.B"],
    ["3514", "3599", "passiva.C"],
    ["3600", "3634", "passiva.C", "aktiva.B"],
    ["3635", "3635", "passiva.C"],
    ["3640", "3641", "passiva.C", "aktiva.B"],
    ["3642", "3643", "passiva.C"],
    ["3645", "3653", "passiva.C", "aktiva.B"],
    ["3655", "3658", "passiva.C"],
    ["3695", "3695", "aktiva.B"],
    ["3700", "3701", "passiva.C", "aktiva.B"],
    ["3710", "3715", "passiva.C"],
    ["3720", "3771", "passiva.C", "aktiva.B"],
    ["3780", "3786", "passiva.C"],
    ["3790", "3796", "passiva.C", "aktiva.B"],
    ["3798", "3799", "passiva.C"],
    ["3800", "3809", "passiva.C", "aktiva.B"],
    ["3810", "3816", "passiva.B", "aktiva.B"],
    ["3817", "3818", "passiva.C"],
    ["3819", "3830", "passiva.C", "aktiva.B"],
    ["3831", "3831", "passiva.C"],
    ["3832", "3851", "passiva.C", "aktiva.B"],
    ["3854", "3860", "passiva.C"],
    ["3865", "3865", "passiva.C", "aktiva.B"],
    ["3900", "3950", "passiva.D"],
    ["4000", "4589", "umsatzerloese"],
    ["4600", "4689", "sonstigeErtraege"],
    ["4690", "4799", "umsatzerloese"],
    ["4800", "4832", "sonstigeErtraege"],
    ["4833", "4833", "umsatzerloese"],
    ["4834", "4858", "sonstigeErtraege"],
    ["4860", "4869", "umsatzerloese"],
    ["4900", "4989", "sonstigeErtraege"],
    ["4992", "4992", "umsatzerloese"],
    ["5000", "5985", "materialaufwand"],
    ["6000", "6171", "personalaufwand"],
    ["6200", "6291", "abschreibungen"],
    ["6300", "6999", "sonstigeAufwendungen"],
    ["7000", "7143", "sonstigeErtraege"],
    ["7144", "7145", "sonstigeErtraege", "sonstigeAufwendungen"],
    ["7190", "7194", "sonstigeErtraege"],
    ["7200", "7255", "abschreibungen"],
    ["7300", "7363", "sonstigeAufwendungen"],
    ["7364", "7365", "sonstigeAufwendungen", "sonstigeErtraege"],
    ["7366", "7390", "sonstigeAufwendungen"],
    ["7392", "7464", "sonstigeErtraege"],
    ["7551", "7563", "sonstigeAufwendungen"],
    ["7600", "7694", "steuern"],
    ["7800", "8000", "sonstigeAufwendungen"],
  ],
};

/** Bereich eines Kontos; undefined = nicht zugeordnet (Klasse 9, Lücken) */
function bereichOf(kontenrahmen: Kontenrahmen, account: string): Bereich | undefined {
  if (!/^\d{4}$/.test(account)) return undefined;
  return BEREICHE[kontenrahmen].find(([von, bis]) => account >= von && account <= bis);
}

/** Posten eines Kontos bei gewöhnlichem Saldo; null = nicht zugeordnet */
export function postenOf(kontenrahmen: Kontenrahmen, account: string): Posten | null {
  return bereichOf(kontenrahmen, account)?.[2] ?? null;
}

/**
 * Posten für einen Saldo: Steht ein Aktivkonto im Haben oder ein Passivkonto im Soll, gilt der zweite Posten des
 * DATEV-Kontenrahmens, etwa die Bank im Haben unter den Verbindlichkeiten oder „Umsatzsteuer nicht fällig“ im Soll unter
 * den sonstigen Vermögensgegenständen; ebenso Erfolgskonten wie „Sonstige Aufwendungen oder Sonstige Erträge“. Ohne zweiten Posten bleibt das Konto, wo es ist, mit negativem Betrag.
 */
export function postenForSaldo(kontenrahmen: Kontenrahmen, account: string, saldo: Cents): Posten | null {
  const bereich = bereichOf(kontenrahmen, account);
  if (!bereich) return null;
  const [, , posten, umgekehrt] = bereich;
  // Auch in der GuV: ein Ertragskonto im Soll bzw. ein Aufwandskonto im Haben steht im zweiten Posten
  const reversed =
    (posten.startsWith("aktiva.") && saldo < 0) ||
    (posten.startsWith("passiva.") && saldo > 0) ||
    (posten === "umsatzerloese" || posten === "sonstigeErtraege" ? saldo > 0 : !isBilanz(posten) && saldo < 0);
  return reversed && umgekehrt ? umgekehrt : posten;
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
 * Bilanz und GuV aus den Salden zum Stichtag, je Konto mit dem Posten für seinen Saldo (postenForSaldo). Das
 * Jahresergebnis kommt aus der GuV und steht im Eigenkapital.
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
    const posten = postenForSaldo(kontenrahmen, account, saldo);
    if (posten === null || isBilanz(posten) !== carriesForward(kontenrahmen, account)) {
      nichtZugeordnet.push({ account, saldo });
      continue;
    }
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
