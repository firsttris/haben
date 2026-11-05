import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  abrechnen,
  abrechnenSchema,
  employeeSchema,
  entwurfLoeschen,
  entwurfNeuBerechnen,
  entwurfSchema,
  festschreiben,
  festschreibenSchema,
  getEmployee,
  listEmployees,
  monatsuebersicht,
  nachbuchen,
  saveEmployee,
  stornieren,
  stornoSchema,
} from "../modules/lohn/index.ts";
import { today } from "../today.ts";

const monatSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) });

/** Monat mit Abrechnungen je Mitarbeiter und die Liste der Mitarbeiter */
export const getLohn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(monatSchema)
  .handler(async ({ data }) => {
    const [monat, employees] = await Promise.all([monatsuebersicht(data.year, data.month), listEmployees()]);
    return {
      monat,
      employees: employees.map((e) => ({
        id: e.id,
        personalnummer: e.personalnummer,
        name: `${e.vorname} ${e.nachname}`,
        art: e.art,
        monatsgehalt: e.monatsgehalt,
        eintritt: e.eintritt,
        austritt: e.austritt,
      })),
      today: today(),
    };
  });

export const getMitarbeiter = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const e = await getEmployee(data);
    return e ? { ...e, createdAt: undefined, updatedAt: undefined } : null;
  });

export const saveMitarbeiterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), data: employeeSchema }))
  .handler(async ({ data, context }) => ({ id: await saveEmployee(context.user.id, data.id, data.data) }));

export const abrechnenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(abrechnenSchema)
  .handler(({ data, context }) => abrechnen(context.user.id, data));

export const entwurfNeuBerechnenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(entwurfSchema)
  .handler(async ({ data, context }) => {
    await entwurfNeuBerechnen(context.user.id, data);
    return { ok: true };
  });

export const entwurfLoeschenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await entwurfLoeschen(context.user.id, data);
    return { ok: true };
  });

export const festschreibenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(festschreibenSchema)
  .handler(async ({ data, context }) => {
    await festschreiben(context.user.id, data, today());
    return { ok: true };
  });

export const stornierenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(stornoSchema)
  .handler(({ data, context }) => stornieren(context.user.id, data, today()));

/** Bucht eine Abrechnung, die vor der Lohnbuchung festgeschrieben wurde */
export const nachbuchenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await nachbuchen(context.user.id, data);
    return { ok: true };
  });
