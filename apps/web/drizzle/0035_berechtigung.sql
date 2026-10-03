CREATE TABLE "brm_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"dateninhaber_idnr" text,
	"antrags_id" text,
	"status" text,
	"genehmigen_bis" text,
	"gueltig_bis" text,
	"liste" jsonb,
	"test" boolean NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
