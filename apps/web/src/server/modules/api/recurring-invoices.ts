import { z } from "zod";
import { createRecurring, recurringInputSchema } from "../rechnungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { requestSchemas, responseSchemas } from "./schemas.ts";

const recurringCreateSchema = recurringInputSchema
  .omit({ active: true, mode: true, sendByMail: true })
  .extend({
    format: recurringInputSchema.shape.format.optional(),
    paymentTermDays: recurringInputSchema.shape.paymentTermDays.optional(),
    note: recurringInputSchema.shape.note.default(""),
    taxTreatment: recurringInputSchema.shape.taxTreatment.optional(),
    exemptionReason: recurringInputSchema.shape.exemptionReason.default(""),
    endDate: recurringInputSchema.shape.endDate.default(null),
    servicePeriod: recurringInputSchema.shape.servicePeriod.default("laufend"),
  })
  .strict()
  .register(requestSchemas, { id: "RecurringInvoiceCreate" });

const recurringCreatedSchema = z.object({ id: z.uuid(), active: z.literal(false), url: z.url() }).register(responseSchemas, { id: "RecurringInvoiceCreated" });

export async function createRecurringInvoiceHandler(request: ApiRequest): Promise<ApiResult> {
  const parsed = validate(recurringCreateSchema, request.body);
  if ("failure" in parsed) return parsed.failure;

  const { data } = parsed;
  const company = await loadCompany();
  const { id } = await createRecurring(request.actor, {
    ...data,
    format: data.format ?? company.defaultFormat,
    taxTreatment: data.taxTreatment ?? (company.kleinunternehmer ? "kleinunternehmer" : "regulaer"),
    paymentTermDays: data.paymentTermDays ?? company.paymentTermDays,
    active: false,
    mode: "entwurf",
    sendByMail: false,
  });
  const url = `${request.baseUrl}/rechnungen/wiederkehrend/${id}`;
  const result = { id, active: false, url } satisfies z.output<typeof recurringCreatedSchema>;
  return ok(result, 201, { Location: url });
}
