import { createServerFn } from "@tanstack/react-start";
import { exportYears } from "../modules/archiv/index.ts";
import { readMiddleware } from "../middleware.ts";

/** Jahre, für die es Daten gibt, plus laufendes und voriges Jahr */
export const getExportYears = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .handler(() => exportYears());
