import {
  currentFilingPeriod,
  currentMonth,
  dueDate,
  filingPeriodSchema,
  FREQUENCY_START_MONTHS,
  periodKey,
  recentFilingPeriods,
  latestEndedPeriod,
  lastMonthOfPeriod,
  VAT_FREQUENCIES,
  type VatPeriod,
} from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { companyIssues, kleinunternehmerForMonth, loadCompany } from "../modules/stammdaten/index.ts";
import { inputTaxForPeriod } from "../modules/belege/index.ts";
import {
  computeVatFigures,
  dauerfristFor,
  dauerfristOverview,
  frequencyOverview,
  kz39For,
  loadFrequencies,
  meinElsterUstvaWerte,
  periodProblem,
  preflight,
  saveDauerfrist,
  saveFrequency,
  submitDauerfrist,
  filingsFor,
  ustvaPosten,
  ustvaPostenForPeriod,
  VatError,
  vermerkeAbgabe,
} from "../modules/umsatzsteuer/index.ts";
import { UserError } from "../errors.ts";
import { MAX_DOCUMENT_SIZE } from "../modules/belege/index.ts";
import { abgleichIssues, vatAbgleich } from "../modules/auswertungen/index.ts";
import { elsterClient, elsterMode } from "../modules/elster/index.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import { openAppealDeadlines } from "../modules/finanzamt/index.ts";
import { pendingDepreciation } from "../modules/buchhaltung/index.ts";
import { today } from "../today.ts";
import {
  computedValues,
  createCorrection,
  recentSentReturns,
  returnsForPeriod,
  saveDraft,
  submissionsFor,
  submitReturn,
} from "../modules/umsatzsteuer/index.ts";
import { loadActiveCertificate } from "../modules/elster/index.ts";
import { transitBalance } from "../modules/buchhaltung/index.ts";

// Negativ möglich, etwa wenn Gutschriften im Monat überwiegen
const centsSchema = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);

function certificateSummary(certificate: Awaited<ReturnType<typeof loadActiveCertificate>>) {
  return certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null;
}

export const getVatPeriod = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(filingPeriodSchema)
  .handler(async ({ data: period }) => {
    const [returns, company, certificate, recent, inputTax, figures, settings] = await Promise.all([
      returnsForPeriod(period),
      loadCompany(),
      loadActiveCertificate(),
      recentSentReturns(),
      inputTaxForPeriod(period),
      computeVatFigures(period),
      loadFrequencies(),
    ]);
    const submissions = await submissionsFor(returns.map((r) => r.id));
    const filings = await filingsFor(returns.map((r) => r.id));
    const current = returns.find((r) => r.status === "draft") ?? returns[0] ?? null;
    const last = lastMonthOfPeriod(period);
    const dauerfrist = await dauerfristOverview(period.year, settings);
    return {
      period,
      // Mit Dauerfristverlängerung einen Monat später (§ 46 UStDV)
      dueDate: dueDate(period, company.bundesland, dauerfrist.active),
      /** Dauerfristverlängerung und Sondervorauszahlung des Jahres */
      dauerfrist,
      /** Abzug der Sondervorauszahlung, nur in der letzten Voranmeldung des Jahres */
      kz39: await kz39For(period),
      /** Zeiträume zur Auswahl nach der Einstellung: der laufende und die der letzten zwölf Monate */
      periods: recentFilingPeriods(settings, currentMonth(new Date())),
      /** Voranmeldungszeitraum des Jahres und Vorschlag aus der Steuer des Vorjahres */
      frequency: await frequencyOverview(period.year, settings),
      /** Passt der Zeitraum nicht zur Einstellung, die Meldung dazu; gesendete Anmeldungen bleiben trotzdem sichtbar */
      periodProblem: periodProblem(settings, period),
      // Stand am Ende des Zeitraums: nach der Umstellung zum Jahreswechsel ist der Dezember noch fällig
      kleinunternehmer: await kleinunternehmerForMonth(last.year, last.month),
      current,
      returns,
      submissions,
      /** Abgaben außerhalb von Haben, vermerkt mit Tag, Transferticket und Protokoll */
      filings,
      /** Heute in Deutschland, Obergrenze für den Tag der Abgabe */
      today: today(),
      /** Zahllast bzw. Erstattung je abgegebener Anmeldung des Zeitraums mit Zahlungen (offener Posten) */
      posten: await ustvaPostenForPeriod(period),
      recent,
      certificate: certificateSummary(certificate),
      companyIssues: companyIssues(company),
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
      /** Vorsteuer aus gebuchten Belegen dieses Monats */
      inputTax,
      /** Aus den Buchungen berechnete Kennzahlen mit ihren Quellen */
      figures,
      // Offenes im Zeitraum und der Abgleich mit dem Journal
      preflight: [...(await preflight(period, figures)), ...abgleichIssues(await vatAbgleich(period))],
    };
  });

/** Zeitraum, den /umsatzsteuer öffnet: der zuletzt abgelaufene, befreit der Vormonat */
export const getFilingPeriodKey = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const now = new Date();
    return periodKey(latestEndedPeriod(await loadFrequencies(), currentMonth(now)) ?? currentFilingPeriod(now));
  });

export const getOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const now = new Date();
    const settings = await loadFrequencies();
    // Der zuletzt abgelaufene Zeitraum; befreit (keine Voranmeldung) bleibt es beim Vormonat, ohne Aufgabe
    const ended = latestEndedPeriod(settings, currentMonth(now));
    const period: VatPeriod = ended ?? currentFilingPeriod(now);
    const last = lastMonthOfPeriod(period);
    const [returns, company, certificate, recent, computed] = await Promise.all([
      returnsForPeriod(period),
      loadCompany(),
      loadActiveCertificate(),
      recentSentReturns(3),
      computedValues(period),
    ]);
    const current = returns.find((r) => r.status === "draft") ?? returns[0] ?? null;
    const { posten, ohneBezug } = await ustvaPosten();
    const periodEnd = new Date(Date.UTC(last.year, last.month, 0)).toISOString().slice(0, 10);
    return {
      period,
      /** Zahllast aus den Buchungen, solange keine Anmeldung gespeichert ist */
      computedKz83: computed.kz83,
      /** Geldtransit ohne Gegenseite (Saldo von 1360 bzw. 1460) */
      transit: await transitBalance(),
      /**
       * Nach Ende des Zeitraums schon an das Finanzamt gezahlt, ohne Bezug auf eine Voranmeldung und ohne passenden
       * Posten: zählt für den noch nicht abgegebenen Zeitraum
       */
      vatPaid: ohneBezug.filter((z) => z.bookingDate > periodEnd).reduce((s, z) => s - z.amount, 0),
      /** Offene Zahllast und Erstattungen abgegebener Voranmeldungen (offene Posten) */
      vatOpen: posten
        .filter((p) => p.offen !== 0)
        .map((p) => ({ vatReturnId: p.vatReturnId, year: p.year, month: p.month, offen: p.offen, faellig: p.faellig, berichtigt: p.berichtigt })),
      dueDate: dueDate(period, company.bundesland, await dauerfristFor(period.year)),
      /** Von der Voranmeldung befreit: keine Aufgabe zur Voranmeldung */
      exempt: ended === null || periodProblem(settings, period) !== null,
      /** Vormonat, für den Umsatz in der Übersicht */
      previousMonth: currentFilingPeriod(now),
      // Stand am Ende des Zeitraums: nach der Umstellung zum Jahreswechsel ist der Dezember noch fällig
      kleinunternehmer: await kleinunternehmerForMonth(last.year, last.month),
      afaPending: await pendingDepreciation(today()),
      appeals: (await openAppealDeadlines(today())).map((d) => ({
        id: d.id,
        datenart: d.datenart,
        veranlagungszeitraum: d.veranlagungszeitraum,
        fristende: d.frist!.fristende,
      })),
      current,
      recent,
      certificate: certificateSummary(certificate),
      companyIssues: companyIssues(company),
      companyName: company.name,
      mode: elsterMode(),
    };
  });

export const saveVatDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("berechnet"), period: filingPeriodSchema }),
      z.object({
        mode: z.literal("manuell"),
        period: filingPeriodSchema,
        kz81: centsSchema,
        kz86: centsSchema,
        kz21: centsSchema,
        kz45: centsSchema,
        kz48: centsSchema,
        kz66: centsSchema,
        kz46: centsSchema.default(0),
        kz47: centsSchema.default(0),
        kz84: centsSchema.default(0),
        kz85: centsSchema.default(0),
        kz67: centsSchema.default(0),
        kz39: centsSchema.default(0),
        reason: z.string().trim().min(10, "Bitte begründen, warum von den berechneten Werten abgewichen wird (mindestens 10 Zeichen).").max(1000),
      }),
    ]),
  )
  .handler(async ({ data, context }) => {
    const { period, ...input } = data;
    const saved = await saveDraft(context.user.id, period, input);
    return { id: saved.id };
  });

export const createVatCorrection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(filingPeriodSchema)
  .handler(async ({ data, context }) => {
    const created = await createCorrection(context.user.id, data);
    return { id: created.id };
  });

export const submitVatReturn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.uuid(),
      kind: z.enum(["validate", "test", "send"]),
      pin: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await submitReturn(context.user.id, data.id, elsterClient(), {
      kind: data.kind,
      pin: data.pin,
      herstellerId: env().ELSTER_HERSTELLER_ID,
    });
    return {
      ok: result.ok,
      code: result.code,
      message: result.message,
      transferTicket: result.transferTicket ?? null,
    };
  });

/** Werte der gespeicherten Voranmeldung für die Erweiterung, die Mein ELSTER ausfüllt */
export const getMeinElsterUstvaWerte = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => meinElsterUstvaWerte(data.id));

/** Voranmeldungszeitraum ab Jahr und Quartalsbeginn, wie ihn das Finanzamt festgelegt hat */
export const saveVatFrequency = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      year: z.number().int().min(2000).max(2100),
      fromMonth: z.union(FREQUENCY_START_MONTHS.map((m) => z.literal(m))),
      frequency: z.enum(VAT_FREQUENCIES),
    }),
  )
  .handler(async ({ data, context }) => saveFrequency(context.user.id, data));

const yearSchema = z.number().int().min(2000).max(2100);
/** Sondervorauszahlung in Cent, volle Euro (Kz 38) */
const svzSchema = z.number().int().min(0).max(1_000_000_000_00).multipleOf(100, "Sondervorauszahlung in vollen Euro").nullable();

/** Antrag auf Dauerfristverlängerung bzw. Anmeldung der Sondervorauszahlung (USt 1 H) prüfen oder übermitteln */
export const submitVatDauerfrist = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      year: yearSchema,
      kind: z.enum(["validate", "test", "send"]),
      pin: z.string().max(64).optional(),
      sondervorauszahlung: svzSchema,
      berichtigt: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await submitDauerfrist(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

/** Stand der Dauerfristverlängerung von Hand: außerhalb von Haben beantragt oder beendet */
export const saveVatDauerfrist = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, active: z.boolean(), sondervorauszahlung: svzSchema }))
  .handler(async ({ data, context }) => saveDauerfrist(context.user.id, data));

/**
 * Abgabe außerhalb von Haben vermerken (XML-Import in Mein ELSTER, Erweiterung, KI-Assistent): Tag, Transferticket,
 * Kz 83 laut Protokoll und das Übermittlungsprotokoll als PDF
 */
export const fileVatReturnElsewhere = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const fields = z
      .object({
        id: z.uuid(),
        filedOn: z.iso.date("Bitte den Tag der Abgabe angeben."),
        transferTicket: z.string().trim().min(1, "Bitte das Transferticket angeben.").max(64),
        kz83: z.coerce.number().int().pipe(centsSchema),
      })
      .safeParse(Object.fromEntries(["id", "filedOn", "transferTicket", "kz83"].map((k) => [k, data.get(k)])));
    if (!fields.success) throw new UserError(fields.error.issues[0]?.message ?? "Angaben unvollständig.");
    const file = data.get("protokoll");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Bitte das Übermittlungsprotokoll (PDF) auswählen.");
    if (file.size > MAX_DOCUMENT_SIZE) throw new UserError("Das Protokoll ist größer als 20 MB.");
    return { ...fields.data, file };
  })
  .handler(async ({ data, context }) => {
    try {
      const bytes = new Uint8Array(await data.file.arrayBuffer());
      await vermerkeAbgabe(context.user.id, data.id, {
        filedOn: data.filedOn,
        transferTicket: data.transferTicket,
        kz83: data.kz83,
        file: { bytes, filename: data.file.name },
      });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof VatError) return { ok: false as const, message: error.message };
      throw error;
    }
  });
