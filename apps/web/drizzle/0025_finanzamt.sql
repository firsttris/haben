CREATE TABLE "elster_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"betreff" text NOT NULL,
	"text" text NOT NULL,
	"figures" jsonb,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"transfer_ticket" text,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
