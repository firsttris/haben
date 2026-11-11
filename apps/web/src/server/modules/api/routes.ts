import type { z } from "zod";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import type { TokenScope } from "../mcp/index.ts";
import { createContactHandler, getContactHandler, listContactsHandler, updateContactHandler } from "./contacts.ts";
import type { Handler } from "./http.ts";
import { createDocumentHandler, getDocumentHandler, listDocumentsHandler } from "./documents.ts";
import { createInvoiceHandler, deleteInvoiceHandler, getInvoiceHandler, listInvoicesHandler, updateInvoiceHandler } from "./invoices.ts";
import { createServiceEntryHandler, deleteServiceEntryHandler, listServiceEntriesHandler } from "./leistungen.ts";
import { serviceEntryQuerySchema } from "./leistungen-schemas.ts";
import { contactQuerySchema, documentQuerySchema, invoiceQuerySchema } from "./schemas.ts";

/*
 * Alle Endpunkte von /api/v1 an einer Stelle: Pfad, Recht, Handler und was die OpenAPI-Beschreibung über sie sagt.
 * router.ts verteilt danach, openapi.ts beschreibt danach; beides kann nicht auseinanderlaufen.
 */

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiRoute {
  method: Method;
  /** Pfad unter /api/v1 in der Schreibweise von OpenAPI, Parameter als {id} (immer eine UUID) */
  path: string;
  scope: TokenScope;
  summary: string;
  description?: string;
  tag: "Kontakte" | "Rechnungen" | "Belege" | "Leistungen";
  query?: z.ZodObject;
  /** Name in requestSchemas */
  requestBody?: string;
  /** Body als multipart/form-data statt JSON, höchstens so viele Bytes */
  multipartLimit?: number;
  /** Status → Name in responseSchemas (null: ohne Inhalt) und Beschreibung */
  responses: Record<number, { schema: string | null; description: string }>;
  /** Fehler, die nur dieser Endpunkt kennt: Status → Beschreibung */
  errors?: Record<number, string>;
  handler: Handler;
}

export const API_ROUTES: ApiRoute[] = [
  {
    method: "GET",
    path: "/kontakte",
    scope: "kontakte:lesen",
    tag: "Kontakte",
    summary: "Kontakte auflisten",
    description: "Ohne archivierte Kontakte, nach Name sortiert. Mit q z. B. nach der E-Mail-Adresse eines Käufers suchen.",
    query: contactQuerySchema,
    responses: { 200: { schema: "ContactList", description: "Eine Seite Kontakte" } },
    handler: listContactsHandler,
  },
  {
    method: "POST",
    path: "/kontakte",
    scope: "kontakte:schreiben",
    tag: "Kontakte",
    summary: "Kontakt anlegen",
    requestBody: "ContactCreate",
    responses: { 201: { schema: "Contact", description: "Angelegt; Location zeigt auf den Kontakt" } },
    handler: createContactHandler,
  },
  {
    method: "GET",
    path: "/kontakte/{id}",
    scope: "kontakte:lesen",
    tag: "Kontakte",
    summary: "Kontakt lesen",
    responses: { 200: { schema: "Contact", description: "Der Kontakt" } },
    handler: getContactHandler,
  },
  {
    method: "PATCH",
    path: "/kontakte/{id}",
    scope: "kontakte:schreiben",
    tag: "Kontakte",
    summary: "Kontakt ändern",
    description:
      "Nur die genannten Felder ändern sich. Jede Änderung legt eine neue Version an; Rechnungen behalten den Stand, mit dem sie geschrieben wurden.",
    requestBody: "ContactPatch",
    responses: { 200: { schema: "Contact", description: "Der geänderte Kontakt" } },
    handler: updateContactHandler,
  },
  {
    method: "GET",
    path: "/rechnungen",
    scope: "rechnungen:lesen",
    tag: "Rechnungen",
    summary: "Rechnungen auflisten",
    description: "Entwürfe zuerst, dann nach Nummer absteigend. Mit externalSource und externalId die Rechnung zu einer Bestellung finden.",
    query: invoiceQuerySchema,
    responses: { 200: { schema: "InvoiceList", description: "Eine Seite Rechnungen" } },
    handler: listInvoicesHandler,
  },
  {
    method: "POST",
    path: "/rechnungen",
    scope: "rechnungen:entwuerfe",
    tag: "Rechnungen",
    summary: "Rechnungsentwurf anlegen",
    description:
      "Legt einen Entwurf an; festgeschrieben wird in Haben. Nicht angegebene Felder nehmen die Vorgaben aus den Firmendaten, Format und Sprache die des Kontakts. " +
      "Mit externalSource und externalId idempotent: Gibt es die Referenz schon, kommt die vorhandene Rechnung unverändert mit 200 zurück.",
    requestBody: "InvoiceDraftCreate",
    responses: {
      201: { schema: "Invoice", description: "Entwurf angelegt; Location zeigt auf ihn" },
      200: { schema: "Invoice", description: "Zu dieser externen Referenz gibt es schon eine Rechnung, sie bleibt unverändert" },
    },
    handler: createInvoiceHandler,
  },
  {
    method: "GET",
    path: "/rechnungen/{id}",
    scope: "rechnungen:lesen",
    tag: "Rechnungen",
    summary: "Rechnung lesen",
    description: "Entwürfe und festgeschriebene Rechnungen, mit Positionen und offenem Betrag.",
    responses: { 200: { schema: "Invoice", description: "Die Rechnung" } },
    handler: getInvoiceHandler,
  },
  {
    method: "PATCH",
    path: "/rechnungen/{id}",
    scope: "rechnungen:entwuerfe",
    tag: "Rechnungen",
    summary: "Rechnungsentwurf ändern",
    description: "Nur solange Entwurf. Nur die genannten Felder ändern sich; lines ersetzt alle Positionen. Die externe Referenz bleibt.",
    requestBody: "InvoiceDraftPatch",
    responses: { 200: { schema: "Invoice", description: "Der geänderte Entwurf" } },
    errors: { 409: "Die Rechnung ist festgeschrieben" },
    handler: updateInvoiceHandler,
  },
  {
    method: "DELETE",
    path: "/rechnungen/{id}",
    scope: "rechnungen:entwuerfe",
    tag: "Rechnungen",
    summary: "Rechnungsentwurf löschen",
    description: "Nur solange Entwurf; danach ist die externe Referenz wieder frei.",
    responses: { 204: { schema: null, description: "Gelöscht" } },
    errors: { 409: "Die Rechnung ist festgeschrieben" },
    handler: deleteInvoiceHandler,
  },
  {
    method: "GET",
    path: "/belege",
    scope: "belege:lesen",
    tag: "Belege",
    summary: "Belege auflisten",
    description:
      "Zu prüfende Belege zuerst, dann nach Belegdatum absteigend. Mit externalSource und externalId sehen, ob ein Dokument schon da und gebucht ist.",
    query: documentQuerySchema,
    responses: { 200: { schema: "DocumentList", description: "Eine Seite Belege" } },
    handler: listDocumentsHandler,
  },
  {
    method: "POST",
    path: "/belege",
    scope: "belege:anlegen",
    tag: "Belege",
    summary: "Beleg hochladen",
    description:
      "Legt einen Eingangsbeleg als „Zu prüfen“ an, wie der Upload unter Belege: E-Rechnungen werden sofort gelesen, andere PDFs und Fotos von der " +
      "KI-Auslesung im Hintergrund, wenn sie eingerichtet ist. Gebucht wird in Haben. Mit externalSource und externalId idempotent: Gibt es die " +
      "Referenz schon, kommt der vorhandene Beleg unverändert mit 200 zurück. Dieselbe Datei ohne Referenz liefert ebenfalls den vorhandenen Beleg; " +
      "liegt sie mit einer anderen oder ohne Referenz schon vor, antwortet die API mit 409 und existingId.",
    requestBody: "DocumentUpload",
    // Platz für die Felder und Grenzen des Formulars neben der größten Datei
    multipartLimit: MAX_DOCUMENT_SIZE + 1024 * 1024,
    responses: {
      201: { schema: "Document", description: "Beleg angelegt; Location zeigt auf ihn" },
      200: { schema: "Document", description: "Diese Referenz oder ohne Referenz diese Datei gibt es schon; der Beleg bleibt unverändert" },
    },
    errors: { 409: "Dieselbe Datei liegt mit einer anderen oder ohne Referenz schon vor; existingId nennt den Beleg" },
    handler: createDocumentHandler,
  },
  {
    method: "GET",
    path: "/belege/{id}",
    scope: "belege:lesen",
    tag: "Belege",
    summary: "Beleg lesen",
    description: "Stand der Prüfung: Status, ob gebucht, was vor dem Buchen noch fehlt, und der Link zur Seite in Haben.",
    responses: { 200: { schema: "Document", description: "Der Beleg" } },
    handler: getDocumentHandler,
  },
  {
    method: "GET",
    path: "/leistungen",
    scope: "leistungen:lesen",
    tag: "Leistungen",
    summary: "Leistungseinträge auflisten",
    description: "Die neuesten Arbeitstage zuerst; mit contactId, from und to eingrenzen.",
    query: serviceEntryQuerySchema,
    responses: { 200: { schema: "ServiceEntryList", description: "Eine Seite Einträge" } },
    handler: listServiceEntriesHandler,
  },
  {
    method: "POST",
    path: "/leistungen",
    scope: "leistungen:schreiben",
    tag: "Leistungen",
    summary: "Leistungseintrag anlegen",
    description:
      "Legt einen Zeiteintrag für einen Kunden an. Der Stundensatz kommt vom Kunden, wenn der Aufruf keinen mitbringt, und bleibt als Kopie am Eintrag. " +
      "Mit source und externalId (z. B. kimai und die Nummer der Zeile) idempotent: Gibt es die Kennung schon, wird der Eintrag aktualisiert und mit 200 zurückgegeben, statt zu verdoppeln.",
    requestBody: "ServiceEntryCreate",
    responses: {
      201: { schema: "ServiceEntry", description: "Angelegt; Location zeigt auf den Eintrag" },
      200: { schema: "ServiceEntry", description: "Diese Kennung gab es schon; der Eintrag ist aktualisiert" },
    },
    errors: { 422: "Der Kunde gibt es nicht" },
    handler: createServiceEntryHandler,
  },
  {
    method: "DELETE",
    path: "/leistungen/{id}",
    scope: "leistungen:schreiben",
    tag: "Leistungen",
    summary: "Leistungseintrag löschen",
    responses: { 204: { schema: null, description: "Gelöscht" } },
    handler: deleteServiceEntryHandler,
  },
];
