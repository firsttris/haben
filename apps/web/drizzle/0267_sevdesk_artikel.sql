ALTER TABLE "articles" ADD COLUMN "sevdesk_id" text;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_sevdesk_id_unique" UNIQUE("sevdesk_id");