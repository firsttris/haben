import { definePlugin } from "nitro";
import { startScheduler } from "../scheduler.ts";

// Hintergrundjobs (wiederkehrende Rechnungen) laufen im Serverprozess
export default definePlugin(() => {
  startScheduler();
});
