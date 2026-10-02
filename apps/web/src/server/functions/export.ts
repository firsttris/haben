import { createServerFn } from "@tanstack/react-start";
import { exportYears } from "../export.ts";
import { authMiddleware } from "../middleware.ts";

/** Jahre, für die es Daten gibt, plus laufendes und voriges Jahr */
export const getExportYears = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => exportYears());
