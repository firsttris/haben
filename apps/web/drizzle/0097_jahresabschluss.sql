CREATE TABLE "year_closings" (
	"year" integer PRIMARY KEY NOT NULL,
	"entries" integer DEFAULT 0 NOT NULL,
	"digest" text DEFAULT '' NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
