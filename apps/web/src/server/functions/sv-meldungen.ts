import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import { ausfuellliste, ruecknahmeSchema, vermerken, vermerkSchema, zuruecknehmen } from "../modules/sv-meldungen/index.ts";
import { today } from "../today.ts";

const monatSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) });

/** Ausfüllliste eines Monats für das SV-Meldeportal mit dem Stand der Vermerke */
export const getSvMeldeportal = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(monatSchema)
  .handler(async ({ data }) => {
    const heute = today();
    const liste = await ausfuellliste(data.year, data.month, heute);
    return { ...liste, heute };
  });

/** Vermerk „im Portal abgegeben“, auf Wunsch mit dem Protokoll des Portals als Datei */
export const vermerkenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const felder = vermerkSchema.parse({ gegenstand: data.get("gegenstand"), datum: data.get("datum"), notiz: data.get("notiz") ?? "" });
    const datei = data.get("protokoll");
    return { ...felder, protokoll: datei instanceof File && datei.size > 0 ? datei : null };
  })
  .handler(async ({ data, context }) => {
    const { protokoll, ...felder } = data;
    const datei = protokoll ? { bytes: new Uint8Array(await protokoll.arrayBuffer()), filename: protokoll.name } : undefined;
    return { id: await vermerken(context.user.id, felder, today(), datei) };
  });

export const zuruecknehmenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(ruecknahmeSchema)
  .handler(async ({ data, context }) => {
    await zuruecknehmen(context.user.id, data, today());
    return { ok: true };
  });
