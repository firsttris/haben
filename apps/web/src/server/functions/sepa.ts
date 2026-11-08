import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createSepaTransfer,
  decideDocumentIban,
  ibanDecisionSchema,
  listAccounts,
  listSepaTransfers,
  sepaTransferSchema,
  transferCandidates,
} from "../modules/bank/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

export const getTransferPage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    // Auftraggeber kann nur ein Bankkonto mit IBAN sein, kein Zahlungsdienstleister
    const accounts = (await listAccounts()).filter((a) => a.iban !== null && a.purpose !== "zahlungsdienstleister");
    return {
      candidates: await transferCandidates(),
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, iban: a.iban!, purpose: a.purpose })),
      transfers: await listSepaTransfers(),
      today: today(),
    };
  });

export const createSepaTransferFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(sepaTransferSchema)
  .handler(async ({ data, context }) => createSepaTransfer(context.user.id, data));

/** Welche IBAN für einen Beleg gilt, wenn die E-Rechnung eine andere nennt als der Kontakt (#410) */
export const decideDocumentIbanFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ documentId: z.uuid(), decision: ibanDecisionSchema }))
  .handler(async ({ data, context }) => {
    await decideDocumentIban(context.user.id, data.documentId, data.decision);
    return { ok: true };
  });
