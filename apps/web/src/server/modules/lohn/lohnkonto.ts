import { BESCHAEFTIGUNGSARTEN, KONFESSIONEN, lohnkonto, lohnkontoCsv, type Lohnkonto, type LohnkontoZeile, type LohnStammdaten } from "@haben/core";
import { buildLohnkontoPdf } from "@haben/einvoice";
import type { PayslipMitarbeiter } from "../../db/schema.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { abrechnungPdf } from "./abrechnung-pdf.ts";
import { type Employee, getEmployee, payslipMitarbeiter } from "./employees.ts";
import { abrechnungenDesJahres, getPayslip } from "./payroll.ts";

/*
 * Lohnkonto je Mitarbeiter und Kalenderjahr (§ 41 Abs. 1 EStG, § 4 LStDV) aus den festgeschriebenen Abrechnungen, als
 * PDF oder CSV, und das PDF einer einzelnen Abrechnung. Inhalt und Summen rechnet `lohnkonto` in @haben/core.
 */

const STEUERKLASSEN = ["", "I", "II", "III", "IV", "V", "VI"];
const zahl = (tausendstel: number) => (tausendstel / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 });

/** Allgemeine Besteuerungsmerkmale, ausführlich für den Kopf und kurz je Zeile */
function merkmale(l: LohnStammdaten, kurz = false): string {
  const klasse = `${STEUERKLASSEN[l.steuerklasse]}${l.faktor !== 1000 ? ` mit Faktor ${zahl(l.faktor)}` : ""}`;
  if (kurz) return `StKl ${klasse}, Kfb ${zahl(l.kinderfreibetraege)}, ${l.konfession ?? "--"}`;
  return `Steuerklasse ${klasse}, Kinderfreibeträge ${zahl(l.kinderfreibetraege)}, ${l.konfession ? KONFESSIONEN[l.konfession] : "keine Kirchensteuer"}`;
}

function sozialversicherung(m: PayslipMitarbeiter): string {
  if (m.lohn.art === "ggf") return BESCHAEFTIGUNGSARTEN.ggf;
  const kasse = m.lohn.art === "minijob" ? "Minijob-Zentrale" : m.krankenkasse;
  return [
    BESCHAEFTIGUNGSARTEN[m.lohn.art],
    kasse,
    m.beitragsgruppen && `Beitragsgruppen ${m.beitragsgruppen}`,
    m.svNummer && `Versicherungsnummer ${m.svNummer}`,
  ]
    .filter(Boolean)
    .join(", ");
}

type Abrechnung = Awaited<ReturnType<typeof abrechnungenDesJahres>>[number];

function zeilen(a: Abrechnung): LohnkontoZeile[] {
  const zeile: LohnkontoZeile = {
    zahltag: a.zahltag,
    monat: a.month,
    storno: false,
    merkmale: merkmale(a.mitarbeiter.lohn, true),
    brutto: a.brutto,
    steuerBrutto: a.steuerBrutto,
    steuerfrei: 0,
    pauschalBrutto: a.pauschalBrutto,
    lohnsteuer: a.lohnsteuer,
    soli: a.soli,
    kirchensteuer: a.kirchensteuer,
    pauschsteuer: a.pauschsteuer,
    svArbeitnehmer: a.svArbeitnehmer,
    // `svArbeitgeber` der Abrechnung enthält die Pauschsteuer; sie hat im Lohnkonto ihre eigene Spalte
    svArbeitgeber: a.svArbeitgeber - a.pauschsteuer,
    netto: a.netto,
  };
  if (!a.storno) return [zeile];
  const negativ = (n: number) => -n;
  return [
    zeile,
    {
      ...zeile,
      zahltag: a.storno.date,
      storno: true,
      brutto: negativ(zeile.brutto),
      steuerBrutto: negativ(zeile.steuerBrutto),
      pauschalBrutto: negativ(zeile.pauschalBrutto),
      lohnsteuer: negativ(zeile.lohnsteuer),
      soli: negativ(zeile.soli),
      kirchensteuer: negativ(zeile.kirchensteuer),
      pauschsteuer: negativ(zeile.pauschsteuer),
      svArbeitnehmer: negativ(zeile.svArbeitnehmer),
      svArbeitgeber: negativ(zeile.svArbeitgeber),
      netto: negativ(zeile.netto),
    },
  ];
}

/** Lohnkonto aus den festgeschriebenen Abrechnungen; Kopf mit dem Stand der letzten, sonst der Stammdaten */
export async function lohnkontoDesJahres(employeeId: string, year: number): Promise<{ konto: Lohnkonto; employee: Employee } | null> {
  const employee = await getEmployee(employeeId);
  if (!employee) return null;
  const abrechnungen = await abrechnungenDesJahres(employeeId, year);
  const m = abrechnungen.at(-1)?.mitarbeiter ?? payslipMitarbeiter(employee);
  const konto = lohnkonto(
    year,
    {
      vorname: m.vorname,
      nachname: m.nachname,
      geburtsdatum: m.geburtsdatum,
      anschrift: [m.strasse, `${m.plz} ${m.ort}`.trim()].filter(Boolean),
      steuerId: m.steuerId,
      personalnummer: String(m.personalnummer),
      eintritt: m.lohn.eintritt,
      austritt: m.lohn.austritt,
      merkmale: merkmale(m.lohn),
      sozialversicherung: sozialversicherung(m),
    },
    abrechnungen.flatMap(zeilen),
  );
  return { konto, employee };
}

const dateiname = (e: Employee) => `${e.nachname}-${e.vorname}`.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export async function lohnkontoDatei(
  employeeId: string,
  year: number,
  format: "pdf" | "csv",
  heute: string,
): Promise<{ format: "csv"; csv: string; filename: string } | { format: "pdf"; pdf: Uint8Array; filename: string } | null> {
  const r = await lohnkontoDesJahres(employeeId, year);
  if (!r) return null;
  const filename = `Lohnkonto-${year}-${dateiname(r.employee)}.${format}`;
  if (format === "csv") return { format, csv: lohnkontoCsv(r.konto), filename };
  const company = await loadCompany();
  const pdf = buildLohnkontoPdf({
    lohnkonto: r.konto,
    arbeitgeber: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
    heute,
  });
  return { format, pdf, filename };
}

/** PDF einer Abrechnung: festgeschrieben das gespeicherte, ein Entwurf neu gesetzt mit Vermerk */
export async function abrechnungDatei(id: string, heute: string) {
  const p = await getPayslip(id);
  if (!p) return null;
  const mm = String(p.month).padStart(2, "0");
  const filename = `Entgeltabrechnung-${p.year}-${mm}-${`${p.mitarbeiter.nachname}-${p.mitarbeiter.vorname}`.replace(/[^\p{L}\p{N}]+/gu, "-")}${p.lockedAt ? "" : "-Entwurf"}.pdf`;
  const data = p.lockedAt && p.pdf ? new Uint8Array(p.pdf) : await abrechnungPdf(p, { entwurf: true, heute });
  return { data, mimeType: "application/pdf", filename };
}
