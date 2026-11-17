CREATE TABLE "fints_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" text NOT NULL,
	"bank_code" text NOT NULL,
	"url" text NOT NULL,
	"login" text NOT NULL,
	"customer_id" text,
	"ciphertext" "bytea" NOT NULL,
	"tan_method" integer,
	"tan_medium" text,
	"banking_information" jsonb NOT NULL,
	"status" text DEFAULT 'aktiv' NOT NULL,
	"accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
