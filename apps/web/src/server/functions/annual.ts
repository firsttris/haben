import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS, type EuerFigures } from "@haben/elster";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AnnualError,
  annualOverview,
  kapgErklaerungen,
  kapgErklaerungSchema,
  meinElsterWerte,
  saveKapgErklaerungAngaben,
  submitAnnual,
  submitKapg,
  vermerkBetrag,
  vermerkFelder,
  vermerkPruefung,
  vermerkeJahresabgabe,
  speichereErklaerteZeilen,
  zeilenwerteSchema,
} from "../modules/jahreserklaerung/index.ts";
import { zeilenForm } from "../../lib/zeilenwerte.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { elsterClient, elsterMode } from "../modules/elster/index.ts";
import { env } from "../env.ts";
import { estAngabenSchema, saveEstAngaben } from "../modules/jahreserklaerung/index.ts";
import { authMiddleware } from "../middleware.ts";
import { reportYears } from "../modules/auswertungen/index.ts";
import { today } from "../today.ts";
import { loadActiveCertificate } from "../modules/elster/index.ts";
import { fetchVastBelege, lastVastRequest, listVastBelege } from "../modules/finanzamt/index.ts";
import {
  activateBerechtigung,
  berechtigungEhegatte,
  defaultGueltigBis,
  refreshBerechtigungen,
  requestBerechtigung,
  revokeBerechtigung,
} from "../modules/finanzamt/index.ts";
import { yearSchema } from "./schemas.ts";
import { UserError } from "../errors.ts";
import { MAX_DOCUMENT_SIZE } from "../modules/belege/index.ts";

/** Zeilen der Anlage EÜR mit Feldkennung und amtlichem Text, nur belegte */
function euerRows(figures: EuerFigures, keys: readonly (keyof typeof EUER_FIELDS)[]) {
  return keys.filter((key) => (figures[key] ?? 0) !== 0).map((key) => ({ key, ...EUER_FIELDS[key], amount: figures[key]! }));
}

export const getAnnualReturns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => {
    const now = today();
    const [overview, years, certificate, belege, lastVast, company, berechtigungLive, berechtigungTest, kapg] = await Promise.all([
      annualOverview(year, now),
      reportYears(),
      loadActiveCertificate(),
      listVastBelege(year),
      lastVastRequest(year),
      loadCompany(),
      berechtigungEhegatte(false),
      berechtigungEhegatte(true),
      kapgErklaerungen(year, now),
    ]);
    const t = company.taxpayer;
    const current = Number(now.slice(0, 4));
    return {
      ...overview,
      kapg,
      euerRows: {
        einnahmen: euerRows(overview.euer.figures, EUER_EINNAHMEN),
        ausgaben: euerRows(overview.euer.figures, EUER_AUSGABEN),
        // Nach dem Gewinn: nachrichtlich die nicht abziehbare Bewirtung, dann Entnahmen und Einlagen
        privat: [
          ...euerRows(overview.euer.figures, ["bewirtungNichtAbziehbar", "gewerbesteuerNichtAbziehbar"]),
          ...(["entnahmen", "einlagen"] as const).map((key) => ({ key, ...EUER_FIELDS[key], amount: overview.euer.figures[key] ?? 0 })),
        ],
      },
      // Abgeschlossene Jahre mit Daten, dazu das Vorjahr
      years: [...new Set([...years.filter((y) => y < current), current - 1])].sort((a, b) => b - a),
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      vast: {
        belege,
        last: lastVast,
        personen: (["a", "b"] as const).flatMap((key) => (t[key] ? [{ key, name: `${t[key].vorname} ${t[key].name}` }] : [])),
        pinSaved: Boolean(certificate?.pinCiphertext),
        berechtigung: { live: berechtigungLive, test: berechtigungTest, gueltigBisVorschlag: defaultGueltigBis(now) },
      },
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
      today: now,
    };
  });

export const submitAnnualReturn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      form: z.enum(["ust", "euer", "est"]),
      year: yearSchema,
      kind: z.enum(["validate", "test", "send"]),
      pin: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await submitAnnual(context.user.id, data.form, data.year, elsterClient(), {
      kind: data.kind,
      pin: data.pin,
      herstellerId: env().ELSTER_HERSTELLER_ID,
      today: today(),
    });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

/**
 * Abgabe außerhalb von Haben vermerken (WISO, Accountable, ELSTER-Portal): Tag, Transferticket, Betrag, Begründung und
 * optional das Übermittlungsprotokoll. Weicht der Betrag vom gerechneten Wert ab, geht der Vermerk nur mit dem Haken
 * "Abweichung bestätigt" durch; der Hinweis in der Antwort bleibt zusätzlich für die Anzeige.
 */
export const fileAnnualElsewhere = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const fields = z
      .object({
        form: z.enum(["ust", "euer"]),
        // FormData liefert Text; die Jahresgrenzen prüft yearSchema
        year: z.coerce.number().pipe(yearSchema),
        // Tag, Ticket, Betrag und Begründung prüfen wie das Modul; hier nur die Form des FormData-Felds davor
        ...vermerkFelder,
        amount: z.coerce.number().int().pipe(vermerkBetrag),
        // Der Haken kommt als "1" oder "on"; fehlt er, ist die Abweichung nicht bestätigt
        abweichungBestaetigt: z
          .string()
          .nullish()
          .transform((wert) => wert === "1" || wert === "on"),
      })
      .safeParse(Object.fromEntries(["form", "year", "filedOn", "transferTicket", "amount", "note", "abweichungBestaetigt"].map((k) => [k, data.get(k)])));
    if (!fields.success) throw new UserError(fields.error.issues[0]?.message ?? "Angaben unvollständig.");
    const protokoll = data.get("protokoll");
    if (protokoll instanceof File && protokoll.size > MAX_DOCUMENT_SIZE) throw new UserError("Das Protokoll ist größer als 20 MB.");
    return { ...fields.data, file: protokoll instanceof File && protokoll.size > 0 ? protokoll : null };
  })
  .handler(async ({ data, context }) => {
    try {
      const bytes = data.file ? new Uint8Array(await data.file.arrayBuffer()) : undefined;
      await vermerkeJahresabgabe(context.user.id, data.form, data.year, {
        filedOn: data.filedOn,
        transferTicket: data.transferTicket,
        amount: data.amount,
        note: data.note,
        abweichungBestaetigt: data.abweichungBestaetigt,
        ...(data.file && bytes ? { file: { bytes } } : {}),
      });
      // Der Vergleich ist nur ein Hinweis: Scheitert er, bleibt der Vermerk trotzdem gespeichert
      const pruefung = await vermerkPruefung(data.form, data.year, data.amount).catch(() => null);
      return { ok: true as const, hinweis: pruefung?.hinweis ?? null };
    } catch (error) {
      if (error instanceof AnnualError) return { ok: false as const, message: error.message };
      throw error;
    }
  });

/**
 * Zeilenwerte einer außerhalb von Haben abgegebenen Erklärung erfassen (#997). Die Zeilen gehören zu einem
 * vorhandenen Vermerk; Feldkennungen prüft das Modul gegen die Liste der jeweiligen Erklärungsart.
 */
export const saveAnnualFigures = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    const geprueft = zeilenwerteSchema.extend({ form: zeilenForm, year: yearSchema }).safeParse(data);
    if (!geprueft.success) throw new UserError(geprueft.error.issues[0]?.message ?? "Angaben unvollständig.");
    return geprueft.data;
  })
  .handler(async ({ data, context }) => {
    try {
      const anzahl = await speichereErklaerteZeilen(context.user.id, data.form, data.year, data.zeilen);
      return { ok: true as const, anzahl };
    } catch (error) {
      if (error instanceof AnnualError) return { ok: false as const, message: error.message };
      throw error;
    }
  });

/** Werte einer Jahreserklärung für die Erweiterung, die Mein ELSTER ausfüllt */
export const getMeinElsterWerte = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ form: z.enum(["ust", "euer", "est"]), year: yearSchema }))
  .handler(async ({ data }) => meinElsterWerte(data.form, data.year, today()));

export const saveIncomeTaxInputs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, angaben: estAngabenSchema }))
  .handler(async ({ data, context }) => {
    await saveEstAngaben(context.user.id, data.year, data.angaben);
    return { ok: true };
  });

export const fetchVast = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, person: z.enum(["a", "b"]), kind: z.enum(["test", "send"]), pin: z.string().max(64).optional() }))
  .handler(({ data, context }) => fetchVastBelege(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

const brmBase = z.object({ kind: z.enum(["test", "send"]), pin: z.string().max(64).optional() });

export const requestVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase.extend({ gueltigBis: z.iso.date() }))
  .handler(({ data, context }) => requestBerechtigung(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

export const activateVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase.extend({ freischaltcode: z.string().trim().min(1).max(20) }))
  .handler(({ data, context }) => activateBerechtigung(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

export const revokeVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase)
  .handler(({ data, context }) => revokeBerechtigung(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

export const refreshVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase)
  .handler(({ data, context }) => refreshBerechtigungen(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

/** GmbH und UG: Körperschaft- oder Gewerbesteuererklärung prüfen oder senden */
export const submitKapgReturn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ form: z.enum(["kst", "gewst"]), year: yearSchema, kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const result = await submitKapg(context.user.id, data.form, data.year, elsterClient(), {
      kind: data.kind,
      pin: data.pin,
      herstellerId: env().ELSTER_HERSTELLER_ID,
      today: today(),
    });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

export const saveKapgErklaerung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, angaben: kapgErklaerungSchema }))
  .handler(({ data, context }) => saveKapgErklaerungAngaben(context.user.id, data.year, data.angaben));
