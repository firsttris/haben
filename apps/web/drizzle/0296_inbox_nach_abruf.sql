ALTER TABLE "inbox_settings" ADD COLUMN "after_fetch" text DEFAULT 'seen' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD COLUMN "archive_folder" text;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_after_fetch" CHECK ("inbox_settings"."after_fetch" in ('seen', 'move', 'delete'));