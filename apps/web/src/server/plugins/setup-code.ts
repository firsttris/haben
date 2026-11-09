import { definePlugin } from "nitro";
import { announceSetupCode } from "../setup-code.ts";
import { holdAppRunningLock, modeStartupProblem } from "../sso-mode.ts";
import { ssoOnly } from "../sso-policy.ts";

// Betriebsart prüfen, dann den Einrichtungscode ins Log, solange Haben im Standardmodus kein Konto hat
export default definePlugin(async (nitroApp) => {
  const problem = await modeStartupProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  // Solange die Anwendung läuft, verweigert die SSO-Übernahme auf der Kommandozeile die Arbeit
  const release = await holdAppRunningLock();
  nitroApp.hooks.hook("close", release);
  if (!ssoOnly()) void announceSetupCode().catch((e: unknown) => console.error("Einrichtungscode", e));
});
