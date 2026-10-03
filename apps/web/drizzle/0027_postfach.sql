CREATE TABLE "postfach_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referenz_id" text NOT NULL,
	"bereitstellung_id" text NOT NULL,
	"datenart" text NOT NULL,
	"veranlagungszeitraum" text NOT NULL,
	"steuernummer" text NOT NULL,
	"bescheiddatum" text NOT NULL,
	"dateibezeichnung" text NOT NULL,
	"mime_type" text NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"test" boolean NOT NULL,
	"request_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postfach_documents_referenz_id_unique" UNIQUE("referenz_id")
);
--> statement-breakpoint
CREATE TABLE "postfach_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"test" boolean NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"bereitstellung_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"fehler" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "taxpayer" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "postfach_documents" ADD CONSTRAINT "postfach_documents_request_id_postfach_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."postfach_requests"("id") ON DELETE no action ON UPDATE no action;