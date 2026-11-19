CREATE TABLE "journal_umstellung" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stichjahr_vorher" integer,
	"ergebnis" text NOT NULL,
	"befunde" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
