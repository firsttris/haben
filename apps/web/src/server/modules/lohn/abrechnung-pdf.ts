import { BESCHAEFTIGUNGSARTEN, KONFESSIONEN, legalInfo, monatsgrenzen } from "@haben/core";
import { buildLohnabrechnungPdf, type LohnabrechnungDocument } from "@haben/einvoice";
import { db, type Db, type Tx } from "../../db/index.ts";
import type { PayslipMitarbeiter } from "../../db/schema.ts";
import { loadCompany, loadLetterhead } from "../stammdaten/index.ts";
import type { Payslip } from "./payroll.ts";

/*
 * Entgeltabrechnung als PDF (Typst wie die Rechnung, @haben/einvoice) aus einer gespeicherten Abrechnung. Festgeschrieben
 * entsteht das PDF einmal und liegt in der versiegelten Zeile; ein Entwurf wird bei jedem Abruf neu gesetzt und trägt
 * den Vermerk „Entwurf“.
 */

/** Betriebsnummer der Minijob-Zentrale, Einzugsstelle für alle Minijobs im gewerblichen Bereich */
const MINIJOB_ZENTRALE = "Minijob-Zentrale (Betriebsnummer 98000006)";

/** Kennziffer der Pflegeversicherung nach § 1 Abs. 1 Nr. 9 EntgBV */
function pflegeKennziffer(m: PayslipMitarbeiter): string {
  const { kinderlosenzuschlag, kinderUnter25 } = m.lohn.pflege;
  if (kinderlosenzuschlag) return "0 (Zuschlag für Kinderlose)";
  if (kinderUnter25 > 0) return `${Math.min(kinderUnter25, 5)} (Kinder unter 25)`;
  return "ohne Zuschlag für Kinderlose";
}

function einzugsstelle(m: PayslipMitarbeiter): string {
  if (m.lohn.art === "minijob") return MINIJOB_ZENTRALE;
  return m.krankenkasseBetriebsnummer ? `${m.krankenkasse} (Betriebsnummer ${m.krankenkasseBetriebsnummer})` : m.krankenkasse;
}

/** Druckdaten einer Abrechnung */
export async function abrechnungDokument(p: Payslip, options: { entwurf: boolean; heute: string; q?: Db | Tx }): Promise<LohnabrechnungDocument> {
  const [company, letterhead] = await Promise.all([loadCompany(options.q ?? db), loadLetterhead()]);
  const m = p.mitarbeiter;
  const { lohn } = m;
  const legal = legalInfo(company);
  const { letzter } = monatsgrenzen(p.year, p.month);
  return {
    ...letterhead,
    ...(legal ? { legalInfo: legal } : {}),
    arbeitgeber: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
    arbeitnehmer: {
      vorname: m.vorname,
      nachname: m.nachname,
      strasse: m.strasse,
      plz: m.plz,
      ort: m.ort,
      geburtsdatum: m.geburtsdatum,
      personalnummer: m.personalnummer,
      steuerId: m.steuerId,
      svNummer: m.svNummer,
      iban: m.iban,
    },
    jahr: p.year,
    monat: p.month,
    zahltag: p.zahltag,
    ausgestellt: options.heute,
    eintritt: lohn.eintritt,
    // Das Ende der Beschäftigung steht in der Bescheinigung für den letzten Abrechnungszeitraum (§ 1 Abs. 1 Nr. 5 EntgBV)
    austritt: lohn.austritt && lohn.austritt <= letzter ? lohn.austritt : null,
    steuertage: p.steuertage,
    svTage: p.svTage,
    beschaeftigung: BESCHAEFTIGUNGSARTEN[lohn.art],
    steuer: {
      steuerklasse: lohn.steuerklasse,
      faktor: lohn.faktor,
      kinderfreibetraege: lohn.kinderfreibetraege,
      konfession: lohn.konfession ? `${lohn.konfession} (${KONFESSIONEN[lohn.konfession]})` : null,
    },
    sv:
      lohn.art === "ggf"
        ? null
        : {
            personengruppe: m.personengruppe,
            beitragsgruppen: m.beitragsgruppen,
            einzugsstelle: einzugsstelle(m),
            pflegeKennziffer: pflegeKennziffer(m),
            uebergangsbereich: p.sv.bemessung.arbeitnehmer !== null,
          },
    bestandteile: p.bestandteile,
    betraege: {
      brutto: p.brutto,
      steuerBrutto: p.steuerBrutto,
      svBrutto: p.svBrutto,
      pauschalBrutto: p.pauschalBrutto,
      lohnsteuer: p.lohnsteuer,
      soli: p.soli,
      kirchensteuer: p.kirchensteuer,
      sv: p.sv,
      netto: p.netto,
      zuschuss: p.auszahlung - p.netto,
      auszahlung: p.auszahlung,
    },
    entwurf: options.entwurf,
    gegenpruefen: p.gegenpruefen && !p.gegengeprueft,
  };
}

export async function abrechnungPdf(p: Payslip, options: { entwurf: boolean; heute: string; q?: Db | Tx }): Promise<Uint8Array> {
  return buildLohnabrechnungPdf(await abrechnungDokument(p, options));
}
