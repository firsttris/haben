import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { removeVividConnection, vividAbrufen, vividVerbinden, vividVerbindenSchema } from "../modules/bank/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Kontoabruf über die Vivid Business API (#1393): Verbinden mit API-Schlüssel, Abruf auf Knopfdruck, Trennen */

export const connectVivid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(vividVerbindenSchema)
  .handler(async ({ data, context }) => vividVerbinden(context.user.id, data));

export const syncVivid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => vividAbrufen(context.user.id, data));

export const disconnectVivid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await removeVividConnection(context.user.id, data);
    return { ok: true };
  });
