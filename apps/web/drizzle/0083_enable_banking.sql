CREATE TABLE "enable_banking_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"application_id" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enable_banking_settings_single_row" CHECK ("enable_banking_settings"."id" = 1)
);
