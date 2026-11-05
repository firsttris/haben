import { DARLEHEN_LAUFZEITEN, DARLEHEN_ZWECKE, DARLEHENSGEBER } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../middleware.ts";
import { createLoan, listLoans, loanSchema } from "../modules/bank/index.ts";

export const getLoans = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({
    loans: await listLoans(),
    lenders: Object.entries(DARLEHENSGEBER).map(([value, label]) => ({ value, label })),
    terms: Object.entries(DARLEHEN_LAUFZEITEN).map(([value, label]) => ({ value, label })),
    purposes: Object.entries(DARLEHEN_ZWECKE).map(([value, label]) => ({ value, label })),
  }));

export const createLoanFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(loanSchema)
  .handler(async ({ data, context }) => ({ id: await createLoan(context.user.id, data) }));
