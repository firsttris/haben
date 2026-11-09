CREATE TABLE "letterhead_background" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"background" "bytea" NOT NULL,
	"format" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letterhead_background_single" CHECK ("letterhead_background"."id" = 1)
);
