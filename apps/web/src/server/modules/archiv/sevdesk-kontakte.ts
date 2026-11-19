import { firstByContact, isSevMainContact, mapSevContact, type SevCommunicationWay, type SevContactAddress, type SevdeskClient } from "@haben/import";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";

/* Kontakte aus sevDesk beim Abruf (sevdesk.ts): neu anlegen, über den Namen verknüpfen oder Rollen ergänzen */

/** 1. Kontakte mit erster Adresse und Haupt-E-Mail; eindeutige Rollen auch im Bestand ergänzen */
export async function importSevdeskContacts(actor: string, client: SevdeskClient, progress: LexofficeImportProgress, save: (force?: boolean) => Promise<void>) {
  const addresses: SevContactAddress[] = [];
  for await (const a of client.contactAddresses()) addresses.push(a);
  const mails: SevCommunicationWay[] = [];
  for await (const m of client.emailAddresses()) mails.push(m);
  const addressBy = firstByContact(addresses);
  const mailBy = firstByContact(mails);
  for await (const raw of client.contacts()) {
    if (!isSevMainContact(raw)) continue;
    const contact = mapSevContact(raw, addressBy.get(String(raw.id)), mailBy.get(String(raw.id)));
    const confirmedRole = contact.role === "supplier" ? { isSupplier: true } : contact.role === "customer" ? { isCustomer: true } : {};
    await withActor(actor, async (tx) => {
      const [known] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.sevdeskId, contact.sevdeskId));
      if (known) {
        // Ohne Herkunft je Rollenfeld lässt sich eine zweite Rolle nicht sicher als Importfehler erkennen.
        if (contact.role) {
          const roleColumn = contact.role === "supplier" ? schema.contacts.isSupplier : schema.contacts.isCustomer;
          await tx
            .update(schema.contacts)
            .set(confirmedRole)
            .where(and(eq(schema.contacts.id, known.id), eq(roleColumn, false)));
        }
        return;
      }
      const [sameName] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(isNull(schema.contacts.sevdeskId), sql`lower(${schema.contacts.name}) = lower(${contact.name})`))
        .limit(1);
      if (sameName) {
        await tx
          .update(schema.contacts)
          .set({ sevdeskId: contact.sevdeskId, ...confirmedRole })
          .where(eq(schema.contacts.id, sameName.id));
        progress.contactsLinked += 1;
        return;
      }
      await tx.insert(schema.contacts).values({
        sevdeskId: contact.sevdeskId,
        // Haben braucht eine Rolle; unklare Kategorien erhalten nur bei Neuanlage die bisherige Kunden-Ausgangsrolle.
        isCustomer: contact.role !== "supplier",
        isSupplier: contact.role === "supplier",
        kundennummer: contact.kundennummer,
        name: contact.name,
        strasse: contact.strasse,
        plz: contact.plz,
        ort: contact.ort,
        land: contact.land,
        email: contact.email,
        ustId: contact.ustId,
      });
      progress.contacts += 1;
    });
    await save();
  }
}
