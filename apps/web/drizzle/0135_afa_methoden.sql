ALTER TABLE "assets" ADD COLUMN "degressive_rate" smallint;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "linear_from_year" smallint;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "memo_value" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_degressive_rate" CHECK (("assets"."method" = 'degressiv') = ("assets"."degressive_rate" is not null) and coalesce("assets"."degressive_rate", 1) between 1 and 3000);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_linear_from_year" CHECK ("assets"."linear_from_year" is null or "assets"."method" = 'degressiv');--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_elektro_kfz" CHECK ("assets"."method" <> 'elektro' or "assets"."kind" = 'kfz');