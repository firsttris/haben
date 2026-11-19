import type { Cents } from "@haben/core";

export type UmsatzgrenzeBestaetigung = { umsatz: Cents; rechnung: Cents; grenze: Cents; vorjahresumsatz?: Cents };
