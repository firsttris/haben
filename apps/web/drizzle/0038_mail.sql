CREATE TABLE "mail_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"reminder_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"secure" boolean NOT NULL,
	"username" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"from_address" text NOT NULL,
	"reminder_to" text NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"reminder_days" smallint[] DEFAULT '{7,1}'::smallint[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_single_row" CHECK ("mail_settings"."id" = 1)
);
