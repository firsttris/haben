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
CREATE TABLE "fastbill_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" text NOT NULL,
	"status" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"date" date,
	"supplier" text DEFAULT '' NOT NULL,
	"gross" integer DEFAULT 0 NOT NULL,
	"ciphertext" "bytea",
	"sha256" text,
	"filename" text,
	"mime_type" text,
	"size" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fastbill_receipts_expense_id_unique" UNIQUE("expense_id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "fastbill_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_fastbill_id_unique" UNIQUE("fastbill_id");