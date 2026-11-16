import { currentYear } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { legacyVatReports, legacyVatReportYears } from "../modules/archiv/index.ts";
import { authMiddleware } from "../middleware.ts";
import { yearSchema } from "./schemas.ts";

/** Übermittelte Voranmeldungen aus der bisherigen Buchhaltung eines Jahres; dazu alle Jahre, in denen es welche gibt */
export const getLegacyVatReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema.optional() }))
  .handler(async ({ data }) => {
    const years = await legacyVatReportYears();
    const year = data.year ?? years[0] ?? currentYear() - 1;
    return { year, years, rows: await legacyVatReports(year) };
  });
