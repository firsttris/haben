import type { z } from "zod";
import { contactSchema as contactInputSchema, createContact, getContact, listContacts, updateContact, type Contact } from "../stammdaten/index.ts";
import { notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { CONTACT_DEFAULTS, contactCreateSchema, contactPatchSchema, contactQuerySchema, type contactSchema } from "./schemas.ts";

/* Kontakte über die REST-API: auflisten, lesen, anlegen, ändern. Gelöscht wird nie, Kontakte sind versioniert (GoBD). */

type ContactOut = z.output<typeof contactSchema>;

export function contactOut(contact: Contact, baseUrl: string): ContactOut {
  return {
    id: contact.id,
    kundennummer: contact.kundennummer,
    name: contact.name,
    strasse: contact.strasse,
    plz: contact.plz,
    ort: contact.ort,
    land: contact.land,
    email: contact.email,
    ustId: contact.ustId,
    iban: contact.iban,
    leitwegId: contact.leitwegId,
    defaultFormat: contact.defaultFormat,
    language: contact.language,
    version: contact.version,
    archived: contact.archivedAt !== null,
    url: `${baseUrl}/kontakte/${contact.id}`,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

/**
 * Eingabe der Oberfläche aus einem gespeicherten Kontakt, für Änderungen einzelner Felder. Mit allen Feldern des
 * Schemas: Was hier fehlt, setzte contactSchema auf seine Vorgabe zurück (etwa einen Lieferanten wieder auf Kunde).
 */
function inputOf(contact: Contact) {
  const { kundennummer, name, strasse, plz, ort, land, email, ustId, iban, leitwegId, defaultFormat, language, isCustomer, isSupplier } = contact;
  return {
    kundennummer: kundennummer ?? "",
    name,
    strasse,
    plz,
    ort,
    land,
    email,
    ustId,
    iban,
    leitwegId,
    defaultFormat,
    language,
    isCustomer,
    isSupplier,
    lieferantennummer: contact.lieferantennummer ?? "",
  };
}

const matches = (contact: Contact, needle: string) =>
  [contact.name, contact.email, contact.kundennummer ?? ""].some((field) => field.toLocaleLowerCase("de").includes(needle));

export async function listContactsHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(contactQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { q, archived, limit, offset } = query.data;
  const needle = q?.toLocaleLowerCase("de");
  const all = (await listContacts(archived === "true")).filter((contact) => !needle || matches(contact, needle));
  return ok({ data: all.slice(offset, offset + limit).map((c) => contactOut(c, request.baseUrl)), total: all.length, limit, offset });
}

export async function getContactHandler(request: ApiRequest): Promise<ApiResult> {
  const found = await getContact(request.params.id!);
  return found ? ok(contactOut(found.contact, request.baseUrl)) : notFound("Kontakt nicht gefunden.");
}

export async function createContactHandler(request: ApiRequest): Promise<ApiResult> {
  const shape = validate(contactCreateSchema, request.body);
  if ("failure" in shape) return shape.failure;
  // Geprüft und bereinigt wird mit dem Schema der Oberfläche, auf den unveränderten Eingaben samt Vorgaben
  const input = validate(contactInputSchema, { ...CONTACT_DEFAULTS, ...(request.body as object) });
  if ("failure" in input) return input.failure;
  const created = await createContact(request.actor, input.data);
  return ok(contactOut(created, request.baseUrl), 201, { Location: `/api/v1/kontakte/${created.id}` });
}

export async function updateContactHandler(request: ApiRequest): Promise<ApiResult> {
  const shape = validate(contactPatchSchema, request.body);
  if ("failure" in shape) return shape.failure;
  const found = await getContact(request.params.id!);
  if (!found) return notFound("Kontakt nicht gefunden.");
  const input = validate(contactInputSchema, { ...inputOf(found.contact), ...(request.body as object) });
  if ("failure" in input) return input.failure;
  return ok(contactOut(await updateContact(request.actor, found.contact.id, input.data), request.baseUrl));
}
