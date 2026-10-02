import { ASSET_KINDS, ASSET_METHODS } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AssetUserError,
  assetInputSchema,
  assetUpdateSchema,
  bookDepreciation,
  canBookYear,
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
} from "../assets.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

function asUserError(error: unknown): never {
  if (error instanceof AssetUserError) throw new Error(error.message);
  throw error;
}

export const kindOptions = Object.entries(ASSET_KINDS).map(([value, kind]) => ({ value, ...kind }));
export const methodOptions = Object.entries(ASSET_METHODS).map(([value, label]) => ({ value, label }));

const yearSchema = z.number().int().min(2000).max(2100);

export const getAssets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => {
    const assets = await listAssets(year);
    const pending = assets.filter((a) => a.pending).length;
    return { year, assets, pending, canBook: canBookYear(year, today()) };
  });

export const getAssetDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getAsset(data);
    if (!result) throw new Error("Anlage nicht gefunden.");
    return result;
  });

export const createAssetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(assetInputSchema)
  .handler(async ({ data, context }) => {
    const asset = await createAsset(context.user.id, data).catch(asUserError);
    return { id: asset.id };
  });

export const updateAssetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), asset: assetUpdateSchema }))
  .handler(async ({ data, context }) => {
    await updateAsset(context.user.id, data.id, data.asset).catch(asUserError);
    return { ok: true };
  });

export const deleteAssetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteAsset(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

export const bookDepreciationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data, context }) => bookDepreciation(context.user.id, data, today()).catch(asUserError));
