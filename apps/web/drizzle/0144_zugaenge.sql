CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"role" text NOT NULL,
	"label" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_email" text,
	"user_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role" CHECK ("invitations"."role" = 'steuerberatung')
);
--> statement-breakpoint
CREATE TABLE "user_logins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"method" text NOT NULL
);
--> statement-breakpoint
-- 0057 legt user_single nur an, wenn es höchstens ein Konto gibt
DROP INDEX IF EXISTS "user_single";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'steuerberatung' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
-- Das bisherige Konto ist der Inhaber; gab es (vor 0057) mehrere, das älteste
UPDATE "user" SET "role" = 'inhaber' WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at", "id" LIMIT 1);--> statement-breakpoint
CREATE INDEX "user_logins_user" ON "user_logins" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_inhaber_single" ON "user" USING btree ("role") WHERE "user"."role" = 'inhaber';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role" CHECK ("user"."role" in ('inhaber', 'steuerberatung'));