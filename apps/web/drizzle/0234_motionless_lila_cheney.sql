CREATE TABLE "app_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"postgres_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
