CREATE TABLE "vast_belege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beleg_id" text NOT NULL,
	"person" text NOT NULL,
	"idnr" text NOT NULL,
	"year" smallint NOT NULL,
	"belegart" text NOT NULL,
	"schemaversion" text NOT NULL,
	"hashwert" text NOT NULL,
	"xml" text NOT NULL,
	"test" boolean NOT NULL,
	"request_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vast_belege_beleg_id_unique" UNIQUE("beleg_id")
);
--> statement-breakpoint
CREATE TABLE "vast_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person" text NOT NULL,
	"idnr" text NOT NULL,
	"year" smallint NOT NULL,
	"test" boolean NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"fehler" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"abholung" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vast_belege" ADD CONSTRAINT "vast_belege_request_id_vast_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."vast_requests"("id") ON DELETE no action ON UPDATE no action;