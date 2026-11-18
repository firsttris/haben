ALTER TABLE "inbox_settings" ADD COLUMN "after_fetch" text DEFAULT 'seen' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "archive_folder" text;