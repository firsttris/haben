CREATE TABLE "fastbill_connection" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"calls_per_hour" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fastbill_connection_single_row" CHECK ("fastbill_connection"."id" = 1),
	CONSTRAINT "fastbill_connection_calls_per_hour" CHECK ("fastbill_connection"."calls_per_hour" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "fastbill_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_fastbill_id_unique" UNIQUE("fastbill_id");