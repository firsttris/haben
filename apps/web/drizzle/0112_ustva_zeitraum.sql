CREATE TABLE "vat_frequencies" (
	"year" smallint NOT NULL,
	"from_month" smallint DEFAULT 1 NOT NULL,
	"frequency" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_frequencies_year_from_month_pk" PRIMARY KEY("year","from_month"),
	CONSTRAINT "vat_frequencies_from_month" CHECK ("vat_frequencies"."from_month" in (1, 4, 7, 10))
);
--> statement-breakpoint
ALTER TABLE "vat_returns" DROP CONSTRAINT "vat_returns_month";--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_month" CHECK ("vat_returns"."month" between 1 and 12 or "vat_returns"."month" between 41 and 44);