import type { z } from "zod";
import type { TokenScope } from "../mcp/index.ts";
import { createContactHandler, getContactHandler, listContactsHandler, updateContactHandler } from "./contacts.ts";
import type { Handler } from "./http.ts";
import { createInvoiceHandler, deleteInvoiceHandler, getInvoiceHandler, listInvoicesHandler, updateInvoiceHandler } from "./invoices.ts";
import { contactQuerySchema, invoiceQuerySchema } from "./schemas.ts";

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
  tag: "Kontakte" | "Rechnungen";
  query?: z.ZodObject;
  /** Name in requestSchemas */
  requestBody?: string;
  /** Status → Name in responseSchemas (null: ohne Inhalt) und Beschreibung */
  responses: Record<number, { schema: string | null; description: string }>;
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
      "Legt einen Entwurf an; festgeschrieben wird in Haben. Nicht angegebene Felder nehmen die Vorgaben aus den Firmendaten. " +
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
    handler: deleteInvoiceHandler,
  },
];
