import { definePlugin } from "nitro";
import { db } from "../db/index.ts";
import { logTriggerIntegrity } from "../db/trigger-inventory.ts";

export default definePlugin(() => {
  void logTriggerIntegrity(db).catch(() => console.error("Sperrtrigger: Prüfung fehlgeschlagen; Datenbankzugriff prüfen."));
});
