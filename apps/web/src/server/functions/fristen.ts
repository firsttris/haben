import { createServerFn } from "@tanstack/react-start";
import {
  calendarTokenActive,
  calendarTokenStatus,
  reactivateCalendarToken,
  createCalendarToken,
  listFristen,
  revokeCalendarToken,
} from "../modules/finanzamt/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

export const getFristen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const now = today();
    const [fristen, abo, aboStatus] = await Promise.all([listFristen(now), calendarTokenActive(), calendarTokenStatus(context.user.id)]);
    return { today: now, fristen, abo, aboStatus };
  });

/** Neuer Abo-Link; das Token kommt nur in dieser Antwort vor */
export const createFristenAbo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ token: await createCalendarToken(context.user.id) }));

export const revokeFristenAbo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await revokeCalendarToken(context.user.id);
    return { ok: true };
  });

export const reactivateFristenAbo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await reactivateCalendarToken(context.user.id);
    return { ok: true };
  });
