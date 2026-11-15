import { SevdeskClient, type SevdeskClientOptions } from "@haben/import";
import { eq } from "drizzle-orm";
import { decrypt } from "../../crypto.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";

/* Zugang zu sevDesk: hinterlegter Token und API-Client, für den Abruf und für Abrufe außerhalb davon (Anlagen). */

export class SevdeskError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: SevdeskClientOptions) => new SevdeskClient({ baseUrl: env().SEVDESK_API_URL || undefined, ...options });

export function setSevdeskClientFactory(factory: (options: SevdeskClientOptions) => SevdeskClient) {
  clientFactory = factory;
}

export const newSevdeskClient = (options: SevdeskClientOptions) => clientFactory(options);

/** Der hinterlegte Token; ohne ihn kein Abruf */
export async function apiKey(): Promise<string> {
  const [row] = await db.select().from(schema.sevdeskConnection).where(eq(schema.sevdeskConnection.id, 1));
  if (!row) throw new SevdeskError("Zuerst den API-Token hinterlegen.");
  return decrypt(row.ciphertext).toString("utf8");
}

/** Client mit dem hinterlegten Token */
export const sevdeskClient = async () => clientFactory({ apiKey: await apiKey() });
