CREATE TABLE "company_logo" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"logo" "bytea" NOT NULL,
	"format" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_logo_single" CHECK ("company_logo"."id" = 1)
);
