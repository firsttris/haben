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

  it("verschweigt alles andere, etwa SQL mit Parametern", () => {
    const query = new Error('Failed query: insert into "bank_accounts" ("iban") values ($1)\nparams: DE89370400440532013000');
    expect(userMessage(query)).toBeUndefined();
    expect(userMessage(new TypeError("[1,2]"))).toBeUndefined();
    expect(userMessage(new Error('[{"x":1}]'))).toBeUndefined();
    expect(userMessage("kaputt")).toBeUndefined();
  });
});
