import { FormatFactoryService, type Invoice, type InvoiceServiceOptions, invoiceSchema, type Logger, ValidationService } from "@e-invoice-eu/core";
import Ajv2019, { type ValidateFunction } from "ajv/dist/2019.js";

/*
 * InvoiceService.generate aus @e-invoice-eu/core (3.4.3, dist/e-invoice-eu.cjs.js), nur mit einem Unterschied: Die
 * Bibliothek legt bei jedem Aufruf ein neues Ajv an und kompiliert das ganze Rechnungsschema, rund 250 ms je Rechnung.
 * Hier geschieht das einmal je Format. Ein kompilierter Validator lässt sich wiederverwenden; ValidationService liest
 * seine Fehler direkt nach dem synchronen Aufruf. generate.test.ts vergleicht die Ausgabe mit der Bibliothek und schlägt
 * fehl, wenn ein Update generate ändert.
 */

const quietLogger: Logger = {
  log: () => {},
  warn: () => {},
  error: (message) => console.error(message),
};

const formats = new FormatFactoryService();
const validation = new ValidationService(quietLogger);
const validators = new Map<string, ValidateFunction<Invoice>>();

/** Kompilierter Validator je normalisiertem Format; patchSchema hängt nur vom Format ab */
function validatorFor(format: string, patchSchema: (schema: typeof invoiceSchema) => unknown): ValidateFunction<Invoice> {
  let validator = validators.get(format);
  if (!validator) {
    const schema = structuredClone(invoiceSchema);
    patchSchema(schema);
    validator = new Ajv2019({ strict: true, allErrors: true, useDefaults: true }).compile<Invoice>(schema);
    validators.set(format, validator);
  }
  return validator;
}

/** Wie InvoiceService.generate: Eingabe prüfen (mit Vorgaben aus dem Schema) und die E-Rechnung im Format erzeugen */
export async function generateEInvoice(input: Invoice, options: InvoiceServiceOptions): Promise<string | Uint8Array> {
  const patched = structuredClone(input);
  const ubl = input["ubl:Invoice"] as Record<string, unknown> | undefined;
  const patchedUbl = patched["ubl:Invoice"] as Record<string, unknown>;
  // Einzelne Note und SubjectCode als Liste, wie die Bibliothek
  if (typeof ubl?.["cbc:Note"] === "string") patchedUbl["cbc:Note"] = [ubl["cbc:Note"]];
  if (typeof ubl?.["x-cii:SubjectCode"] === "string") patchedUbl["x-cii:SubjectCode"] = [ubl["x-cii:SubjectCode"]];

  const formatter = formats.createFormatService(options.format, quietLogger);
  options.format = formats.normalizeFormat(options.format);
  const validator = validatorFor(options.format, (schema) => formatter.patchSchema(schema));
  const invoice = validation.validate("invoice data", validator, patched);
  formatter.patchInvoice(invoice);
  formatter.fillInvoiceDefaults(invoice);
  return formatter.generate(invoice, options);
}
