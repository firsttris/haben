import type { BasisPoints, Cents } from "../money.ts";
import { beitrag, haelftig, uebergangArbeitnehmer, uebergangGesamt } from "./rechnen.ts";
import { type Anteile, type Beschaeftigt, KEINE, mitSummen, type SvBeitraege } from "./typen.ts";
import type { SvJahreswerte } from "./werte.ts";

/** Ob das Entgelt im Übergangsbereich liegt: über der Geringfügigkeitsgrenze bis einschließlich 2.000 € (§ 20 Abs. 2 SGB IV) */
export const imUebergangsbereich = (entgelt: Cents, w: SvJahreswerte): boolean => entgelt > w.geringfuegigkeitsgrenze && entgelt <= w.uebergangsbereichBis;

/** Zahl der Abschläge: ab dem zweiten Kind unter 25, höchstens bis zum fünften (§ 55 Abs. 3 SGB XI) */
const abschlaege = (kinderUnter25: number, w: SvJahreswerte): number => Math.min(Math.max(kinderUnter25 - 1, 0), w.pvAbschlaegeHoechstens);

/** Zusatzbeitrag der Kasse, oder null bei privater Versicherung (dann weder KV noch PV) */
const zusatz = (e: Beschaeftigt): BasisPoints | null => (e.kv.art === "gesetzlich" ? e.kv.zusatzbeitrag : null);

/**
 * Pflegeversicherung außerhalb des Übergangsbereichs. Ohne Sachsen, Zuschlag und Abschläge je zur Hälfte; sonst
 * tragen beide verschieden viel, und der Beitrag ist die Summe der getrennt gerundeten Anteile (§ 2 Abs. 1 Satz 3
 * BVV). Sätze in halben Basispunkten, damit auch ein ungerader Gesamtsatz genau halbiert wird.
 */
function pflege(basis: Cents, e: Beschaeftigt, w: SvJahreswerte): Anteile {
  const { kinderlosenzuschlag, kinderUnter25 } = e.pflege;
  const abschlag = abschlaege(kinderUnter25, w) * w.pvAbschlagJeKind;
  if (!e.sachsen && !kinderlosenzuschlag && abschlag === 0) return haelftig(basis, w.pv);
  const anHalb = (e.sachsen ? 2 * w.pvAnSachsen : w.pv) + 2 * ((kinderlosenzuschlag ? w.pvZuschlagKinderlos : 0) - abschlag);
  const agHalb = e.sachsen ? 2 * w.pvAgSachsen : w.pv;
  return { an: beitrag(basis, anHalb, 2), ag: beitrag(basis, agHalb, 2) };
}

/** Beiträge bei Entgelt über 2.000 €: Bemessung bis zur jeweiligen Beitragsbemessungsgrenze */
export function regulaer(e: Beschaeftigt, w: SvJahreswerte): SvBeitraege {
  const kvPv = Math.min(e.entgelt, w.bbgKvPv);
  const rvAv = Math.min(e.entgelt, w.bbgRvAv);
  const z = zusatz(e);
  return mitSummen({
    personengruppe: "beschaeftigt",
    bemessung: { kvPv, rvAv, arbeitnehmer: null },
    kv: z === null ? KEINE : haelftig(kvPv, w.kv),
    kvZusatz: z === null ? KEINE : haelftig(kvPv, z),
    pv: z === null ? KEINE : pflege(kvPv, e, w),
    rv: haelftig(rvAv, w.rv),
    av: haelftig(rvAv, w.av),
    umlagen: umlagen(rvAv, e, w),
    pauschsteuer: 0,
  });
}

/**
 * Umlagen U1, U2 und Insolvenzgeld vom Entgelt, nach dem die Rentenversicherungsbeiträge bemessen werden (§ 7 Abs. 1
 * AAG, § 358 Abs. 2 SGB III); im Übergangsbereich ist das die reduzierte beitragspflichtige Einnahme.
 */
function umlagen(basis: Cents, e: Beschaeftigt, w: SvJahreswerte): SvBeitraege["umlagen"] {
  return {
    u1: e.umlagen.u1 === null ? 0 : beitrag(basis, e.umlagen.u1),
    u2: beitrag(basis, e.umlagen.u2),
    insolvenzgeld: beitrag(basis, w.insolvenzgeld),
  };
}

/**
 * Zweig im Übergangsbereich nach § 2 Abs. 2 Satz 1, 3 und 4 BVV: Der Beitrag ist der halbe Satz auf die Einnahme
 * nach § 20 Abs. 2a Satz 1 SGB IV, gerundet und verdoppelt; der Anteil des Beschäftigten der halbe Satz auf die
 * Einnahme nach Satz 6, gerundet; der Arbeitgeber trägt die Differenz (ebenso § 249 Abs. 3 SGB V, § 168 Abs. 1
 * Nr. 1d SGB VI, § 58 Abs. 5 SGB XI).
 */
function uebergangZweig(gesamt: Cents, arbeitnehmer: Cents, satz: BasisPoints): Anteile {
  const an = beitrag(arbeitnehmer, satz, 2);
  return { an, ag: 2 * beitrag(gesamt, satz, 2) - an };
}

/**
 * Beiträge im Übergangsbereich. Pflege: Den Kinderlosenzuschlag trägt der Beschäftigte allein, berechnet aus der
 * Einnahme nach § 20 Abs. 2a Satz 1 SGB IV (§ 2 Abs. 2 Satz 6 BVV); die Kinderabschläge mindern seinen Anteil und
 * werden aus der Einnahme nach Satz 6 berechnet (§ 2 Abs. 2 Satz 7 BVV); beide gesondert gerundet. Sachsen lehnt
 * `index.ts` vorher ab.
 */
export function uebergang(e: Beschaeftigt, w: SvJahreswerte): SvBeitraege {
  const gesamt = uebergangGesamt(e.entgelt, w);
  const arbeitnehmer = uebergangArbeitnehmer(e.entgelt, w);
  const z = zusatz(e);
  const pvBasis = uebergangZweig(gesamt, arbeitnehmer, w.pv);
  const zuschlag = e.pflege.kinderlosenzuschlag ? beitrag(gesamt, w.pvZuschlagKinderlos) : 0;
  const abschlag = beitrag(arbeitnehmer, abschlaege(e.pflege.kinderUnter25, w) * w.pvAbschlagJeKind);
  return mitSummen({
    personengruppe: "beschaeftigt",
    bemessung: { kvPv: gesamt, rvAv: gesamt, arbeitnehmer },
    kv: z === null ? KEINE : uebergangZweig(gesamt, arbeitnehmer, w.kv),
    kvZusatz: z === null ? KEINE : uebergangZweig(gesamt, arbeitnehmer, z),
    pv: z === null ? KEINE : { an: pvBasis.an + zuschlag - abschlag, ag: pvBasis.ag },
    rv: uebergangZweig(gesamt, arbeitnehmer, w.rv),
    av: uebergangZweig(gesamt, arbeitnehmer, w.av),
    umlagen: umlagen(gesamt, e, w),
    pauschsteuer: 0,
  });
}
