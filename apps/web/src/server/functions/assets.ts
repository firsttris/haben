import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
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
import { UserError } from "../errors.ts";
import { yearSchema } from "./schemas.ts";

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
    if (!result) throw new UserError("Anlage nicht gefunden.");
    return result;
  });

export const createAssetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(assetInputSchema)
  .handler(async ({ data, context }) => {
    const asset = await createAsset(context.user.id, data);
    return { id: asset.id };
  });

export const updateAssetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), asset: assetUpdateSchema }))
  .handler(async ({ data, context }) => {
    await updateAsset(context.user.id, data.id, data.asset);
    return { ok: true };
  });

export const deleteAssetFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteAsset(context.user.id, data);
    return { ok: true };
  });

export const bookDepreciationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data, context }) => bookDepreciation(context.user.id, data, today()));
