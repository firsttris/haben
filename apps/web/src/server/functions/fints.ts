import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fintsAbrufen, fintsFortsetzen, fintsVerbinden, fintsVerbindenSchema, fintsVerwerfen, removeFintsConnection } from "../modules/bank/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Kontoabruf über FinTS (#654): Verbinden, TAN und Verfahren, Konten wählen, Abruf auf Knopfdruck, Trennen */

export const connectFints = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(fintsVerbindenSchema)
  .handler(async ({ data, context }) => fintsVerbinden(context.user.id, data));

export const continueFints = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      vorgang: z.string().min(1).max(100),
      tan: z.string().max(100).optional(),
      verfahren: z.number().int().min(0).max(999).optional(),
      medium: z.string().max(100).optional(),
      /** IBANs der gewählten Konten; eine IBAN hat höchstens 34 Zeichen */
      konten: z.array(z.string().max(34)).max(100).optional(),
    }),
  )
  .handler(async ({ data: { vorgang, ...eingabe }, context }) => fintsFortsetzen(context.user.id, vorgang, eingabe));

export const cancelFints = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.string().min(1).max(100))
  .handler(async ({ data, context }) => {
    fintsVerwerfen(context.user.id, data);
    return { ok: true };
  });

export const syncFints = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => fintsAbrufen(context.user.id, data));

export const disconnectFints = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await removeFintsConnection(context.user.id, data);
    return { ok: true };
  });
