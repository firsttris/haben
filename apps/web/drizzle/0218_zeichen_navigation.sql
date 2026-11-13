ALTER TABLE "company" ADD COLUMN "nav_color" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "nav_logo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_nav_color" CHECK ("company"."nav_color" ~ '^#[0-9A-F]{6}$');