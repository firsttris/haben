CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aspsp_name" text NOT NULL,
	"aspsp_country" text NOT NULL,
	"psu_type" text NOT NULL,
	"status" text DEFAULT 'wartet' NOT NULL,
	"state" text,
	"ciphertext" "bytea",
	"valid_until" timestamp with time zone,
	"accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_state_unique" UNIQUE("state")
);
