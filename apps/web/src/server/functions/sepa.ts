import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createDirectDebitFile,
  createSepaTransfer,
  directDebitCandidates,
  directDebitFileSchema,
  listDirectDebitFiles,
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

/** Lastschriften als pain.008 aus fälligen Rechnungen (#445) */
export const getDirectDebitPage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    // Gläubigerkonto kann nur ein Bankkonto mit IBAN sein, kein Zahlungsdienstleister
    const accounts = (await listAccounts()).filter((a) => a.iban !== null && a.purpose !== "zahlungsdienstleister");
    const day = today();
    return {
      candidates: await directDebitCandidates(day),
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, iban: a.iban!, purpose: a.purpose })),
      files: await listDirectDebitFiles(),
      today: day,
    };
  });

export const createDirectDebitFileFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(directDebitFileSchema)
  .handler(async ({ data, context }) => createDirectDebitFile(context.user.id, data));
