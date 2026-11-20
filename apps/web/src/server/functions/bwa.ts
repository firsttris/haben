import { FORM01_ZEILEN, FORM43_ZEILEN } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../lib/jahre.ts";
import { bwaBericht, bwaForm01Konten, bwaWarum, bwaZeileDetails } from "../modules/auswertungen/index.ts";
import { readMiddleware } from "../middleware.ts";

/** Höchstens so viele Jahre rechnet ein freier Zeitraum; jedes Jahr ist eine ganze EÜR aus dem Journal */
const HOECHSTENS_JAHRE = 3;

const datum = z.iso.date().refine((d) => Number(d.slice(0, 4)) >= ERSTES_JAHR && Number(d.slice(0, 4)) <= LETZTES_JAHR, "Jahr außerhalb des Bereichs");
const zeitraumSchema = z
  .object({ von: datum, bis: datum })
  .refine((z) => z.von <= z.bis, "Der Zeitraum endet vor seinem Beginn")
  .refine((z) => Number(z.bis.slice(0, 4)) - Number(z.von.slice(0, 4)) < HOECHSTENS_JAHRE, `Höchstens ${HOECHSTENS_JAHRE} Kalenderjahre`);

/** BWA für die Seite „Auswertungen › BWA“ */
export const getBwa = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ zeitraum: zeitraumSchema, vergleich: z.enum(["vorjahr", "vorperiode", "keiner"]) }))
  .handler(({ data }) => bwaBericht(data.zeitraum, data.vergleich));

/** Was in einer Zeile der BWA steht, bis zur Rechnung bzw. zum Beleg */
export const getBwaZeile = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ zeitraum: zeitraumSchema, zeile: z.enum(FORM43_ZEILEN) }))
  .handler(({ data }) => bwaZeileDetails(data.zeitraum, data.zeile));

/** Warum eine Zeile der BWA vom Vergleich abweicht, nach Kontakt */
export const getBwaWarum = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ zeitraum: zeitraumSchema, vergleich: z.enum(["vorjahr", "vorperiode"]), zeile: z.enum(FORM43_ZEILEN) }))
  .handler(({ data }) => bwaWarum(data.zeitraum, data.vergleich, data.zeile));

/** Die Konten einer Zeile der Kurzfristigen Erfolgsrechnung (Form 01, GmbH und UG) im Zeitraum */
export const getBwaKonten = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ zeitraum: zeitraumSchema, zeile: z.enum(FORM01_ZEILEN) }))
  .handler(({ data }) => bwaForm01Konten(data.zeitraum, data.zeile));
