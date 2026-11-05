import { createServerFn } from "@tanstack/react-start";
import { elsterClient, elsterMode, loadActiveCertificate } from "../modules/elster/index.ts";
import { lstbStornoSchema, lstbSubmitSchema, lstbUebersicht, lstbVermerkSchema, stornoLstb, submitLstb, vermerkeLstb } from "../modules/lohn/index.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** Lohnsteuerbescheinigungen eines Jahres je Mitarbeiter, mit Verlauf und dem Stand von ERiC und Zertifikat */
export const getLstb = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => {
    const heute = today();
    const [uebersicht, certificate] = await Promise.all([lstbUebersicht(year, heute), loadActiveCertificate()]);
    return {
      ...uebersicht,
      mitarbeiter: uebersicht.mitarbeiter.map((m) => ({
        ...m,
        // Ohne XML, Protokoll und Angaben: Die Seite zeigt nur, was wann übermittelt wurde
        verlauf: m.verlauf.map((s) => ({
          id: s.id,
          art: s.art,
          kind: s.kind,
          ok: s.ok,
          code: s.code,
          message: s.message,
          datum: s.datum,
          grund: s.grund,
          transferTicket: s.transferTicket,
          createdAt: s.createdAt,
        })),
        aktuell: m.aktuell
          ? { art: m.aktuell.art, kind: m.aktuell.kind, datum: m.aktuell.datum, transferTicket: m.aktuell.transferTicket, werte: m.aktuell.werte }
          : null,
      })),
      heute,
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
    };
  });

const ergebnis = (r: { ok: boolean; code: number; message: string; transferTicket?: string }) => ({
  ok: r.ok,
  code: r.code,
  message: r.message,
  transferTicket: r.transferTicket ?? null,
});

/** Bescheinigung über ERiC prüfen oder übermitteln, neu oder als Korrektur */
export const submitLstbFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(lstbSubmitSchema)
  .handler(async ({ data, context }) =>
    ergebnis(await submitLstb(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID, heute: today() })),
  );

/** Übermittelte Bescheinigung über ERiC stornieren */
export const stornoLstbFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(lstbStornoSchema)
  .handler(async ({ data, context }) =>
    ergebnis(await stornoLstb(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID, heute: today() })),
  );

/** Im ELSTER-Portal übermittelte Bescheinigung, Korrektur oder Stornierung vermerken */
export const vermerkeLstbFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(lstbVermerkSchema)
  .handler(async ({ data, context }) => {
    await vermerkeLstb(context.user.id, data, today());
    return { ok: true };
  });
