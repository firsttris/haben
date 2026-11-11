CREATE TABLE "beleg_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"art" text NOT NULL,
	"source" text NOT NULL,
	"sha256" text NOT NULL,
	"schema_version" smallint NOT NULL,
	"packages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beleg_layouts_name_laenge" CHECK (char_length("beleg_layouts"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "beleg_layouts_name" ON "beleg_layouts" USING btree ("name");