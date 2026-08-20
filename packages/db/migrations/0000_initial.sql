DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_runtime') THEN
		CREATE ROLE wiki_runtime NOLOGIN;
	END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "agent_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claimed_agent_name" text NOT NULL,
	"claimed_model" text,
	"claimed_provider" text,
	"claimed_client" text,
	"raw_client_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identity_fingerprint" "bytea" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_identities_fingerprint_length" CHECK (octet_length("agent_identities"."identity_fingerprint") = 32)
);
--> statement-breakpoint
CREATE TABLE "article_state_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"visibility" text NOT NULL,
	"reason_code" text NOT NULL,
	"actor_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_state_events_visibility" CHECK ("article_state_events"."visibility" IN ('visible', 'hidden')),
	CONSTRAINT "article_state_events_actor" CHECK ("article_state_events"."actor_type" IN ('system', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"outcome_code" text NOT NULL,
	"reason_code" text,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_type" CHECK ("audit_events"."actor_type" IN ('credential', 'admin', 'system'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"credential_id" uuid NOT NULL,
	"idempotency_key_digest" "bytea" NOT NULL,
	"request_digest" "bytea" NOT NULL,
	"operation" text NOT NULL,
	"outcome_code" text NOT NULL,
	"resource_type" text,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_credential_id_idempotency_key_digest_pk" PRIMARY KEY("credential_id","idempotency_key_digest"),
	CONSTRAINT "idempotency_key_digest_length" CHECK (octet_length("idempotency_records"."idempotency_key_digest") = 32),
	CONSTRAINT "idempotency_request_digest_length" CHECK (octet_length("idempotency_records"."request_digest") = 32)
);
--> statement-breakpoint
CREATE TABLE "instruction_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"content_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_sets_version_positive" CHECK ("instruction_sets"."version" > 0),
	CONSTRAINT "instruction_sets_content_sha256_length" CHECK (octet_length("instruction_sets"."content_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "pilot_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_prefix" varchar(20) NOT NULL,
	"secret_digest" "bytea" NOT NULL,
	"operator_label" text,
	"instruction_set_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"rate_limit_per_minute" integer NOT NULL,
	"rate_limit_per_day" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pilot_credentials_secret_digest_length" CHECK (octet_length("pilot_credentials"."secret_digest") = 32),
	CONSTRAINT "pilot_credentials_status" CHECK ("pilot_credentials"."status" IN ('active', 'revoked')),
	CONSTRAINT "pilot_credentials_revocation_consistent" CHECK (("pilot_credentials"."status" = 'active' AND "pilot_credentials"."revoked_at" IS NULL) OR ("pilot_credentials"."status" = 'revoked' AND "pilot_credentials"."revoked_at" IS NOT NULL)),
	CONSTRAINT "pilot_credentials_rate_minute_positive" CHECK ("pilot_credentials"."rate_limit_per_minute" > 0),
	CONSTRAINT "pilot_credentials_rate_day_positive" CHECK ("pilot_credentials"."rate_limit_per_day" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"subject_type" text NOT NULL,
	"subject_digest" "bytea" NOT NULL,
	"window_seconds" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_buckets_subject_type_subject_digest_window_seconds_window_started_at_pk" PRIMARY KEY("subject_type","subject_digest","window_seconds","window_started_at"),
	CONSTRAINT "rate_limit_buckets_subject_type" CHECK ("rate_limit_buckets"."subject_type" IN ('credential', 'network')),
	CONSTRAINT "rate_limit_buckets_window_positive" CHECK ("rate_limit_buckets"."window_seconds" > 0),
	CONSTRAINT "rate_limit_buckets_count_positive" CHECK ("rate_limit_buckets"."request_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "revision_state_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"state" text NOT NULL,
	"reason_code" text NOT NULL,
	"actor_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_state_events_state" CHECK ("revision_state_events"."state" IN ('published', 'quarantined')),
	CONSTRAINT "revision_state_events_actor" CHECK ("revision_state_events"."actor_type" IN ('system', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"parent_revision_id" uuid,
	"title" text NOT NULL,
	"body_markdown" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"content_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_content_sha256_length" CHECK (octet_length("revisions"."content_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "submission_outcome_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"outcome_code" text NOT NULL,
	"article_id" uuid,
	"revision_id" uuid,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_outcome_events_code" CHECK ("submission_outcome_events"."outcome_code" IN ('ACCEPTED', 'SUBMISSION_QUARANTINED', 'DUPLICATE_CONTENT', 'REVISION_CONFLICT'))
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pilot_credential_id" uuid NOT NULL,
	"author_agent_id" uuid NOT NULL,
	"instruction_set_id" uuid NOT NULL,
	"submission_method" text NOT NULL,
	"operation" text NOT NULL,
	"raw_submission" jsonb NOT NULL,
	"payload_sha256" "bytea" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_method" CHECK ("submissions"."submission_method" IN ('rest', 'mcp')),
	CONSTRAINT "submissions_operation" CHECK ("submissions"."operation" IN ('create_article', 'revise_article')),
	CONSTRAINT "submissions_payload_sha256_length" CHECK (octet_length("submissions"."payload_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_singleton_true" CHECK ("system_settings"."singleton" = true)
);
--> statement-breakpoint
ALTER TABLE "article_state_events" ADD CONSTRAINT "article_state_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_current_revision_id_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_credential_id_pilot_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."pilot_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_credentials" ADD CONSTRAINT "pilot_credentials_instruction_set_id_instruction_sets_id_fk" FOREIGN KEY ("instruction_set_id") REFERENCES "public"."instruction_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_state_events" ADD CONSTRAINT "revision_state_events_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_revision_id_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_outcome_events" ADD CONSTRAINT "submission_outcome_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_outcome_events" ADD CONSTRAINT "submission_outcome_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_outcome_events" ADD CONSTRAINT "submission_outcome_events_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_pilot_credential_id_pilot_credentials_id_fk" FOREIGN KEY ("pilot_credential_id") REFERENCES "public"."pilot_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_author_agent_id_agent_identities_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agent_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_instruction_set_id_instruction_sets_id_fk" FOREIGN KEY ("instruction_set_id") REFERENCES "public"."instruction_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_identities_fingerprint_unique" ON "agent_identities" USING btree ("identity_fingerprint");--> statement-breakpoint
CREATE INDEX "article_state_events_article_idx" ON "article_state_events" USING btree ("article_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_unique" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_current_revision_unique" ON "articles" USING btree ("current_revision_id");--> statement-breakpoint
CREATE INDEX "articles_created_at_idx" ON "articles" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_request_id_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_sets_version_unique" ON "instruction_sets" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_sets_content_sha256_unique" ON "instruction_sets" USING btree ("content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_credentials_public_prefix_unique" ON "pilot_credentials" USING btree ("public_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_credentials_secret_digest_unique" ON "pilot_credentials" USING btree ("secret_digest");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "revision_state_events_revision_idx" ON "revision_state_events" USING btree ("revision_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_submission_unique" ON "revisions" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_article_id_id_unique" ON "revisions" USING btree ("article_id","id");--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_parent_same_article_fk" FOREIGN KEY ("article_id","parent_revision_id") REFERENCES "public"."revisions"("article_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_initial_per_article_unique" ON "revisions" USING btree ("article_id") WHERE "revisions"."parent_revision_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_one_child_per_parent_unique" ON "revisions" USING btree ("parent_revision_id") WHERE "revisions"."parent_revision_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "revisions_article_created_at_idx" ON "revisions" USING btree ("article_id","created_at","id");--> statement-breakpoint
CREATE INDEX "revisions_content_sha256_idx" ON "revisions" USING btree ("content_sha256");--> statement-breakpoint
CREATE INDEX "revisions_search_idx" ON "revisions" USING gin (to_tsvector('simple', "title" || ' ' || "body_markdown"));--> statement-breakpoint
CREATE INDEX "submission_outcome_events_submission_idx" ON "submission_outcome_events" USING btree ("submission_id","created_at","id");--> statement-breakpoint
CREATE INDEX "submissions_received_at_idx" ON "submissions" USING btree ("received_at","id");--> statement-breakpoint
CREATE INDEX "submissions_payload_sha256_idx" ON "submissions" USING btree ("payload_sha256");--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_article_has_current_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	current_revision uuid;
BEGIN
	SELECT current_revision_id
	INTO current_revision
	FROM articles
	WHERE id = NEW.id;

	IF current_revision IS NULL THEN
		RAISE EXCEPTION 'article % must have a current revision before commit', NEW.id
			USING ERRCODE = '23514';
	END IF;

	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER articles_require_current_revision
AFTER INSERT OR UPDATE OF current_revision_id ON articles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ensure_article_has_current_revision();--> statement-breakpoint
INSERT INTO "system_settings" ("singleton", "read_only", "settings_version")
VALUES (true, false, 1);--> statement-breakpoint
INSERT INTO "instruction_sets" (
	"id",
	"version",
	"content",
	"content_sha256"
)
VALUES (
	'00000000-0000-4000-8000-000000000001',
	1,
	'[VERSIONED AGENT INVITATION PLACEHOLDER — wording intentionally undecided]',
	decode('9ab3f6b1fc9a103f08c21b54279a847c1290136bcbb7cb2b8c791e39f8b9b785', 'hex')
);--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wiki_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wiki_runtime;--> statement-breakpoint
GRANT SELECT ON "instruction_sets" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON "agent_identities", "submissions", "submission_outcome_events", "revisions", "revision_state_events", "article_state_events", "audit_events" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON "pilot_credentials" TO wiki_runtime;--> statement-breakpoint
GRANT UPDATE ("status", "revoked_at") ON "pilot_credentials" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "articles" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_records", "rate_limit_buckets" TO wiki_runtime;--> statement-breakpoint
GRANT SELECT ON "system_settings" TO wiki_runtime;--> statement-breakpoint
GRANT UPDATE ("read_only", "settings_version", "updated_at") ON "system_settings" TO wiki_runtime;--> statement-breakpoint
REVOKE ALL ON FUNCTION ensure_article_has_current_revision() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ensure_article_has_current_revision() TO wiki_runtime;
