CREATE TYPE "public"."intent_signer" AS ENUM('SERVER', 'EXTERNAL');--> statement-breakpoint
ALTER TABLE "onchain_intents" ADD COLUMN "signer" "intent_signer" DEFAULT 'SERVER' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;