CREATE TABLE "instruction_set_activation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instruction_set_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"actor_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_set_activation_events_actor" CHECK ("instruction_set_activation_events"."actor_type" IN ('system', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "articles" DROP CONSTRAINT "articles_current_revision_id_revisions_id_fk";
--> statement-breakpoint
ALTER TABLE "instruction_set_activation_events" ADD CONSTRAINT "instruction_set_activation_events_instruction_set_id_instruction_sets_id_fk" FOREIGN KEY ("instruction_set_id") REFERENCES "public"."instruction_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instruction_set_activation_events_order_idx" ON "instruction_set_activation_events" USING btree ("created_at","id");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_current_revision_same_article_fk" FOREIGN KEY ("id","current_revision_id") REFERENCES "public"."revisions"("article_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "instruction_set_activation_events" (
	"id",
	"instruction_set_id",
	"reason_code",
	"actor_type",
	"created_at"
)
VALUES (
	'00000000-0000-4000-8000-000000000002',
	'00000000-0000-4000-8000-000000000001',
	'INITIAL_PILOT_ACTIVATION',
	'system',
	'2026-08-20T00:00:00Z'
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_admin') THEN
		CREATE ROLE wiki_admin NOLOGIN;
	END IF;
END
$$;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SCHEMA public FROM wiki_runtime;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wiki_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wiki_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA drizzle TO wiki_runtime;--> statement-breakpoint
GRANT SELECT ON "drizzle"."__drizzle_migrations" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT ON "instruction_sets", "instruction_set_activation_events", "pilot_credentials", "system_settings" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON "agent_identities", "submissions", "submission_outcome_events", "revisions", "revision_state_events", "article_state_events", "audit_events" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON "articles" TO wiki_runtime;--> statement-breakpoint
GRANT UPDATE ("current_revision_id") ON "articles" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON "idempotency_records", "rate_limit_buckets" TO wiki_runtime;--> statement-breakpoint
GRANT UPDATE ("request_count", "expires_at") ON "rate_limit_buckets" TO wiki_runtime;--> statement-breakpoint
REVOKE ALL ON SCHEMA public FROM wiki_admin;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wiki_admin;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wiki_admin;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wiki_admin;--> statement-breakpoint
GRANT INSERT ON "pilot_credentials", "instruction_set_activation_events", "revision_state_events", "article_state_events", "audit_events" TO wiki_admin;--> statement-breakpoint
GRANT UPDATE ("status", "revoked_at") ON "pilot_credentials" TO wiki_admin;--> statement-breakpoint
GRANT UPDATE ("read_only", "settings_version", "updated_at") ON "system_settings" TO wiki_admin;--> statement-breakpoint
GRANT DELETE ON "rate_limit_buckets" TO wiki_admin;
