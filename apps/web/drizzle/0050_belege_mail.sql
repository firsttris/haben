CREATE TABLE "inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"sender" text NOT NULL,
	"subject" text NOT NULL,
	"received_at" timestamp with time zone,
	"document_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"skipped" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "inbox_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"secure" boolean NOT NULL,
	"username" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_settings_single_row" CHECK ("inbox_settings"."id" = 1)
);
