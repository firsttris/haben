import { createServiceEntry, deleteServiceEntry, getServiceEntry, listServiceEntries, upsertExternalServiceEntry } from "../leistungen/index.ts";
import { noContent, notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { serviceEntryCreateSchema, serviceEntryQuerySchema } from "./leistungen-schemas.ts";

/* Leistungseinträge über die REST-API (#417): auflisten, anlegen (mit Quelle und Kennung idempotent), löschen. */

export async function listServiceEntriesHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(serviceEntryQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { limit, offset, ...filter } = query.data;
  const all = await listServiceEntries(filter);
  return ok({ data: all.slice(offset, offset + limit), total: all.length, limit, offset });
}

export async function createServiceEntryHandler(request: ApiRequest): Promise<ApiResult> {
  const input = validate(serviceEntryCreateSchema, request.body);
  if ("failure" in input) return input.failure;
  const { source, externalId, ...rest } = input.data;
  const { id, created } =
    source !== undefined && externalId !== undefined
      ? await upsertExternalServiceEntry(request.actor, { ...rest, source, externalId })
      : { id: await createServiceEntry(request.actor, rest), created: true };
  return ok(await getServiceEntry(id), created ? 201 : 200, created ? { Location: `/api/v1/leistungen/${id}` } : {});
}

export async function deleteServiceEntryHandler(request: ApiRequest): Promise<ApiResult> {
  const id = request.params.id!;
  if (!(await getServiceEntry(id))) return notFound("Eintrag nicht gefunden.");
  await deleteServiceEntry(request.actor, id);
  return noContent();
}
