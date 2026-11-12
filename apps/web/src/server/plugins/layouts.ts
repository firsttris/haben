import { definePlugin } from "nitro";
import { removeOrphanWorkspaces } from "../modules/stammdaten/index.ts";

// Ordner eigener Layouts ohne Eintrag in der Datenbank wegräumen (#113); ein Fehler hält den Start nicht auf
export default definePlugin(() => {
  void removeOrphanWorkspaces()
    .then((removed) => {
      if (removed.length > 0) console.info(`Eigene Layouts: ${removed.length} Ordner ohne Layout entfernt`);
    })
    .catch((error: unknown) => console.error("Eigene Layouts aufräumen", error));
});
