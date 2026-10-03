CREATE TABLE "income_tax_inputs" (
	"year" smallint PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
