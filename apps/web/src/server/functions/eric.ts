import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EricSetupError, ericStatus, startEricInstall } from "../elster.ts";
import { authMiddleware } from "../middleware.ts";

export const getEricStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => ericStatus());

export const installEricLibrary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ version: z.string().trim().max(20), acceptLicense: z.literal(true, "Bitte den Nutzungsbedingungen von ERiC zustimmen.") }))
  .handler(async ({ data, context }) => {
    try {
      startEricInstall(data.version);
    } catch (error) {
      if (error instanceof EricSetupError) throw new Error(error.message, { cause: error });
      throw error;
    }
    console.log(`ERiC-Download ${data.version} gestartet von ${context.user.id}`);
    return { ok: true };
  });
