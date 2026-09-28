CREATE TYPE "public"."agent_decision_status" AS ENUM('PROPOSED', 'POLICY_APPROVED', 'POLICY_REJECTED', 'TX_PENDING', 'TX_CONFIRMED', 'TX_FAILED');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('OBSERVED', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."intent_kind" AS ENUM('CREATE_MARKET', 'PLACE_BET', 'CLOSE_MARKET', 'PROPOSE_RESOLUTION', 'CHALLENGE_RESOLUTION', 'FINALIZE_RESOLUTION', 'CLAIM', 'REGISTER_AGENT');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('PENDING', 'SIGNED', 'BROADCAST', 'CONFIRMED', 'REVERTED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."market_state" AS ENUM('ONCHAIN_PENDING', 'OPEN', 'CLOSED', 'RESOLUTION_PROPOSED', 'FINALIZED', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('UNRESOLVED', 'YES', 'NO', 'INVALID');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('DRAFTED', 'VALIDATED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SCHEMA_REJECTED');--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"backs_yes" boolean,
	"confidence" real,
	"stake_requested_wei" numeric(78, 0),
	"final_stake_wei" numeric(78, 0),
	"rationale" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "agent_decision_status" DEFAULT 'PROPOSED' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_policies" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"per_tx_cap_wei" numeric(78, 0) NOT NULL,
	"daily_budget_wei" numeric(78, 0) NOT NULL,
	"min_confidence" real DEFAULT 0.6 NOT NULL,
	"allowed_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" varchar(128) NOT NULL,
	"action" varchar(64) NOT NULL,
	"subject_type" varchar(32),
	"subject_id" varchar(128),
	"reason" text NOT NULL,
	"tx_hash" varchar(66),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"block_time" timestamp with time zone,
	"address" varchar(42) NOT NULL,
	"event_name" varchar(64),
	"args" jsonb,
	"topic0" varchar(66) NOT NULL,
	"raw_topics" jsonb NOT NULL,
	"raw_data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_items" (
	"event_id" uuid NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"adjudicated_by_llm" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_items_event_id_raw_item_id_pk" PRIMARY KEY("event_id","raw_item_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_key" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"status" "event_status" DEFAULT 'OBSERVED' NOT NULL,
	"distinct_source_count" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_cursors" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"confirmations" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_id" bigint,
	"spec_hash" varchar(66) NOT NULL,
	"proposal_id" uuid,
	"question" text NOT NULL,
	"resolution_source_url" text NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"resolve_deadline" timestamp with time zone NOT NULL,
	"state" "market_state" DEFAULT 'ONCHAIN_PENDING' NOT NULL,
	"outcome" "outcome" DEFAULT 'UNRESOLVED' NOT NULL,
	"pool_yes_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"pool_no_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"evidence_url" text,
	"proposed_by" varchar(42),
	"challenge_ends_at" timestamp with time zone,
	"challenge_count" smallint DEFAULT 0 NOT NULL,
	"creator" varchar(42),
	"created_tx_hash" varchar(66),
	"created_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" varchar(64) NOT NULL,
	"owner_address" varchar(42) NOT NULL,
	"agent_address" varchar(42),
	"agent_key_ciphertext" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(48) NOT NULL,
	"market_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"tx_hash" varchar(66),
	"discord_status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"discord_sent_at" timestamp with time zone,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onchain_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"kind" "intent_kind" NOT NULL,
	"status" "intent_status" DEFAULT 'PENDING' NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"function_name" varchar(64) NOT NULL,
	"data" text NOT NULL,
	"value_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"nonce" integer,
	"gas_limit" bigint,
	"signed_raw_tx" text,
	"tx_hash" varchar(66),
	"block_number" bigint,
	"gas_used" bigint,
	"revert_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'DRAFTED' NOT NULL,
	"spec" jsonb,
	"spec_hash" varchar(66),
	"raw_model_output" text,
	"rejection_reason" text,
	"model" varchar(64),
	"reviewed_by" varchar(42),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_guid" varchar(512) NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"summary" text,
	"content_hash" varchar(66) NOT NULL,
	"injection_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(253) NOT NULL,
	"name" text NOT NULL,
	"independence_group" varchar(64) NOT NULL,
	"allowlisted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_decisions_market_member_round_key" ON "agent_decisions" USING btree ("market_id","member_id","round");--> statement-breakpoint
CREATE INDEX "agent_decisions_status_idx" ON "agent_decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_events_tx_log_key" ON "chain_events" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_events_block_idx" ON "chain_events" USING btree ("block_number","log_index");--> statement-breakpoint
CREATE INDEX "chain_events_name_idx" ON "chain_events" USING btree ("event_name");--> statement-breakpoint
CREATE UNIQUE INDEX "events_cluster_key_key" ON "events" USING btree ("cluster_key");--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_spec_hash_key" ON "markets" USING btree ("spec_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_onchain_id_key" ON "markets" USING btree ("onchain_id") WHERE "markets"."onchain_id" is not null;--> statement-breakpoint
CREATE INDEX "markets_state_idx" ON "markets" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "members_handle_key" ON "members" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "members_agent_address_key" ON "members" USING btree ("agent_address") WHERE "members"."agent_address" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_intents_idempotency_key_key" ON "onchain_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_intents_tx_hash_key" ON "onchain_intents" USING btree ("tx_hash") WHERE "onchain_intents"."tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "onchain_intents_claimable_idx" ON "onchain_intents" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_event_id_key" ON "proposals" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_source_guid_key" ON "raw_items" USING btree ("source_id","source_guid");--> statement-breakpoint
CREATE INDEX "raw_items_content_hash_idx" ON "raw_items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "raw_items_published_at_idx" ON "raw_items" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_domain_key" ON "sources" USING btree ("domain");