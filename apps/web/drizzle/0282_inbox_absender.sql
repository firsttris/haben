ALTER TABLE "inbox_messages" ADD COLUMN "direction" text DEFAULT 'eingang' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "outbound_folder" text;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "allowed_senders" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "last_rejected" integer DEFAULT 0 NOT NULL;