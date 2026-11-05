ALTER TYPE "public"."allocation_kind" ADD VALUE 'steuer';--> statement-breakpoint
ALTER TYPE "public"."allocation_kind" ADD VALUE 'zinsertrag';--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "tax_type" text;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "tax_year" integer;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "tax_item" text;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_tax" CHECK (case when "allocations"."kind"::text = 'steuer' then "allocations"."tax_type" is not null and "allocations"."tax_year" is not null and "allocations"."tax_item" is not null else "allocations"."tax_type" is null and "allocations"."tax_year" is null and "allocations"."tax_item" is null end);