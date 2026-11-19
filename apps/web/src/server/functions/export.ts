import { createServerFn } from "@tanstack/react-start";
import { UserError } from "../errors.ts";
import { archiveTargetOverview } from "../modules/ablage/index.ts";
import { exportYears } from "../modules/archiv/index.ts";
import { datevNumbers } from "../modules/auswertungen/index.ts";
import { importSettings, MAX_SETTINGS_FILE_BYTES, schonAngelegt } from "../modules/instanzwechsel/index.ts";
import { authMiddleware, readMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

/** Jahre, für die es Daten gibt, plus laufendes und voriges Jahr */
export const getExportYears = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .handler(() => exportYears());

/** Bereich Export der Einstellungen: Jahre, DATEV-Nummern, Ablage im Dokumentenarchiv und ob die Instanz neu ist (#488) */
export const getExportArea = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({
    exportYears: await exportYears(),
    datev: await datevNumbers(),
    ablage: await archiveTargetOverview(),
    neueInstanz: (await schonAngelegt()).length === 0,
  }));

/** Einstellungsdatei einer anderen Instanz übernehmen (#488); nur in eine neue Instanz, das prüft das Modul */
export const importSettingsFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const file = data.get("datei");
    if (!(file instanceof File)) throw new UserError("Keine Datei ausgewählt.");
    if (file.size > MAX_SETTINGS_FILE_BYTES) throw new UserError("Die Datei ist zu groß für eine Einstellungsdatei.");
    return { file };
  })
  .handler(async ({ data, context }) => importSettings(context.user.id, new Uint8Array(await data.file.arrayBuffer()), today()));
