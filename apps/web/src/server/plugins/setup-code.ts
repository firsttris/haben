import { definePlugin } from "nitro";
import { announceSetupCode } from "../setup-code.ts";

// Einrichtungscode beim Start ins Log, solange Haben kein Konto hat
export default definePlugin(() => {
  void announceSetupCode().catch((e: unknown) => console.error("Einrichtungscode", e));
});
