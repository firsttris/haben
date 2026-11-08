ALTER TYPE "public"."allocation_kind" ADD VALUE 'kategorie';--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "tax_rate" integer;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_kategorie" CHECK (case when "allocations"."kind"::text = 'kategorie' then "allocations"."category" is not null and "allocations"."tax_rate" is not null else "allocations"."category" is null and "allocations"."tax_rate" is null end);