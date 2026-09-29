CREATE TYPE "public"."resolution_draft_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SCHEMA_REJECTED', 'UNSETTLED', 'STALE');--> statement-breakpoint
CREATE TABLE "resolution_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"status" "resolution_draft_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"outcome" "outcome" DEFAULT 'UNRESOLVED' NOT NULL,
	"evidence_url" text,
	"rationale" text,
	"settled_by_quote" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_model_output" text,
	"rejection_reason" text,
	"model" varchar(64),
	"reviewed_by" varchar(42),
	"reviewed_at" timestamp with time zone,
	"intent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resolution_drafts" ADD CONSTRAINT "resolution_drafts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_drafts_market_round_key" ON "resolution_drafts" USING btree ("market_id","round");--> statement-breakpoint
CREATE INDEX "resolution_drafts_status_idx" ON "resolution_drafts" USING btree ("status");