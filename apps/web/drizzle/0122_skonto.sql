ALTER TABLE "company" ADD COLUMN "skonto" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "skonto" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "skonto" jsonb DEFAULT '[]'::jsonb NOT NULL;