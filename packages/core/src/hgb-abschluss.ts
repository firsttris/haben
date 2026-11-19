import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";
import { carriesForward } from "./vortrag.ts";
import { isBilanz, postenForSaldo, type BilanzPosten, type GuvPosten, type Posten } from "./hgb.ts";

/* Bilanz und GuV einer Kleinstkapitalgesellschaft aus den Salden der Konten (hgb.ts ordnet die Konten den Posten zu) */

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
