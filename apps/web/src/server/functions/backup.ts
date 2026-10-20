import { createServerFn } from "@tanstack/react-start";
import { backupOverview } from "../modules/archiv/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Stand von Backup und Test-Restore, geschrieben vom Backup-Container */
export const getBackupStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => backupOverview());
