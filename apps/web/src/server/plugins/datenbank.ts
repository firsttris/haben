import { definePlugin } from "nitro";
import { closeDatabase } from "../db/index.ts";

// Bei SIGTERM schließt Nitro den HTTP-Server und ruft danach „close“ auf, sobald die laufenden Anfragen fertig sind.
// Die offenen Verbindungen zu PostgreSQL hielten den Prozess sonst am Leben, bis podman stop nach 10 s SIGKILL schickt.
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", () => closeDatabase());
});
