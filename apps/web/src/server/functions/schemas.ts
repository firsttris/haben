import { z } from "zod";

/** Geschäftsjahr in Eingaben der Server Functions und Download-Routen */
export const yearSchema = z.number().int().min(2000).max(2100);
