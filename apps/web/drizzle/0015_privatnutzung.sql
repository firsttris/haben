ALTER TABLE "asset_depreciations" ADD COLUMN "private_use" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD COLUMN "private_use_vat" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "private_use" jsonb;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "private_shares" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "private_share" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_private_use_car" CHECK ("assets"."private_use" is null or "assets"."kind" = 'kfz');