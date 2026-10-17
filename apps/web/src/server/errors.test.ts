import { AssetError } from "@haben/core";
import { StatementParseError } from "@haben/import";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { userMessage, UserError } from "./errors.ts";

describe("userMessage", () => {
  it("gibt Fachfehler der Dienste und Pakete mit ihrer Meldung weiter", () => {
    class BankError extends UserError {}
    expect(userMessage(new BankError("Konto fehlt"))).toBe("Konto fehlt");
    expect(userMessage(new AssetError("Nutzungsdauer fehlt"))).toBe("Nutzungsdauer fehlt");
    expect(userMessage(new StatementParseError("Kein Kontoauszug"))).toBe("Kein Kontoauszug");
  });

  it("macht aus Zod-Fehlern lesbaren Text, auch aus dem Validator von TanStack Start", async () => {
    const schema = z.object({ name: z.string().min(1, "Name fehlt"), plz: z.string().regex(/^\d{5}$/, "PLZ hat fünf Ziffern") });
    expect(userMessage(schema.safeParse({ name: "", plz: "1" }).error)).toBe("Name fehlt; PLZ hat fünf Ziffern");
    // So wirft execValidator in @tanstack/start-client-core (createServerFn.js) bei Standard-Schema-Validatoren
    const result = await schema["~standard"].validate({ name: "", plz: "12345" });
    expect(userMessage(new Error(JSON.stringify(result.issues, undefined, 2)))).toBe("Name fehlt");
  });

  it("gibt Meldungen unserer Trigger weiter, aber keine verletzten Constraints", () => {
    const pg = (fields: Record<string, unknown>) => Object.assign(new Error(String(fields.message)), { severity: "ERROR", ...fields });
    const wrapped = (cause: Error) => Object.assign(new Error('Failed query: update "company" set "kontenrahmen" = $1\nparams: SKR04'), { cause });
    const jahr = "Im Jahr 2026 gibt es schon Buchungen. Kontenrahmen, Versteuerung und Kleinunternehmer lassen sich nur zum Jahreswechsel umstellen, bevor im neuen Jahr gebucht wird.";
    // RAISE EXCEPTION … USING ERRCODE = 'check_violation', von Drizzle verpackt
    expect(userMessage(wrapped(pg({ message: jahr, code: "23514" })))).toBe(jahr);
    // RAISE EXCEPTION ohne ERRCODE, direkt vom Treiber
    expect(userMessage(pg({ message: "Rechnung 1 ist festgeschrieben, Positionen sind unveränderlich", code: "P0001" }))).toBe(
      "Rechnung 1 ist festgeschrieben, Positionen sind unveränderlich",
    );
    // Verletzte CHECK-Constraint: technischer Text, bleibt intern
    expect(userMessage(wrapped(pg({ message: 'new row for relation "allocations" violates check constraint "allocations_target"', code: "23514", constraint_name: "allocations_target" })))).toBeUndefined();
    // Andere Datenbankfehler ebenso
    expect(userMessage(wrapped(pg({ message: 'duplicate key value violates unique constraint "documents_sha256_unique"', code: "23505" })))).toBeUndefined();
    // Nur Fehler des Treibers (mit severity), kein beliebiger Fehler mit passendem Code
    expect(userMessage(wrapped(Object.assign(new Error("geheim"), { code: "P0001" })))).toBeUndefined();
  });

  it("verschweigt alles andere, etwa SQL mit Parametern", () => {
    const query = new Error('Failed query: insert into "bank_accounts" ("iban") values ($1)\nparams: DE89370400440532013000');
    expect(userMessage(query)).toBeUndefined();
    expect(userMessage(new TypeError("[1,2]"))).toBeUndefined();
    expect(userMessage(new Error('[{"x":1}]'))).toBeUndefined();
    expect(userMessage("kaputt")).toBeUndefined();
  });
});
