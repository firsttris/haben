CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer NOT NULL,
	"tax_rate" smallint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
