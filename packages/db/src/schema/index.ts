import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array }>({
  dataType: () => "bytea",
});

const createdAt = () =>
  timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull();

export const instructionSets = pgTable(
  "instruction_sets",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    contentSha256: bytea("content_sha256").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("instruction_sets_version_unique").on(table.version),
    uniqueIndex("instruction_sets_content_sha256_unique").on(table.contentSha256),
    check("instruction_sets_version_positive", sql`${table.version} > 0`),
    check("instruction_sets_content_sha256_length", sql`octet_length(${table.contentSha256}) = 32`),
  ],
);

export const instructionSetActivationEvents = pgTable(
  "instruction_set_activation_events",
  {
    id: uuid("id").primaryKey(),
    instructionSetId: uuid("instruction_set_id")
      .notNull()
      .references(() => instructionSets.id, { onDelete: "restrict" }),
    reasonCode: text("reason_code").notNull(),
    actorType: text("actor_type").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("instruction_set_activation_events_order_idx").on(table.createdAt, table.id),
    check(
      "instruction_set_activation_events_actor",
      sql`${table.actorType} IN ('system', 'admin')`,
    ),
  ],
);

export const pilotCredentials = pgTable(
  "pilot_credentials",
  {
    id: uuid("id").primaryKey(),
    publicPrefix: varchar("public_prefix", { length: 20 }).notNull(),
    secretDigest: bytea("secret_digest").notNull(),
    operatorLabel: text("operator_label"),
    instructionSetId: uuid("instruction_set_id")
      .notNull()
      .references(() => instructionSets.id, { onDelete: "restrict" }),
    termsVersion: text("terms_version").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull(),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull(),
    rateLimitPerDay: integer("rate_limit_per_day").notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("pilot_credentials_public_prefix_unique").on(table.publicPrefix),
    uniqueIndex("pilot_credentials_secret_digest_unique").on(table.secretDigest),
    check("pilot_credentials_secret_digest_length", sql`octet_length(${table.secretDigest}) = 32`),
    check("pilot_credentials_status", sql`${table.status} IN ('active', 'revoked')`),
    check(
      "pilot_credentials_revocation_consistent",
      sql`(${table.status} = 'active' AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`,
    ),
    check("pilot_credentials_rate_minute_positive", sql`${table.rateLimitPerMinute} > 0`),
    check("pilot_credentials_rate_day_positive", sql`${table.rateLimitPerDay} > 0`),
  ],
);

export const agentIdentities = pgTable(
  "agent_identities",
  {
    id: uuid("id").primaryKey(),
    claimedAgentName: text("claimed_agent_name").notNull(),
    claimedModel: text("claimed_model"),
    claimedProvider: text("claimed_provider"),
    claimedClient: text("claimed_client"),
    rawClientMetadata: jsonb("raw_client_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    identityFingerprint: bytea("identity_fingerprint").notNull(),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_identities_fingerprint_unique").on(table.identityFingerprint),
    check("agent_identities_fingerprint_length", sql`octet_length(${table.identityFingerprint}) = 32`),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey(),
    pilotCredentialId: uuid("pilot_credential_id")
      .notNull()
      .references(() => pilotCredentials.id, { onDelete: "restrict" }),
    authorAgentId: uuid("author_agent_id")
      .notNull()
      .references(() => agentIdentities.id, { onDelete: "restrict" }),
    instructionSetId: uuid("instruction_set_id")
      .notNull()
      .references(() => instructionSets.id, { onDelete: "restrict" }),
    submissionMethod: text("submission_method").notNull(),
    operation: text("operation").notNull(),
    rawSubmission: jsonb("raw_submission").$type<Record<string, unknown>>().notNull(),
    payloadSha256: bytea("payload_sha256").notNull(),
    receivedAt: timestamp("received_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("submissions_received_at_idx").on(table.receivedAt, table.id),
    index("submissions_payload_sha256_idx").on(table.payloadSha256),
    check("submissions_method", sql`${table.submissionMethod} IN ('rest', 'mcp')`),
    check("submissions_operation", sql`${table.operation} IN ('create_article', 'revise_article')`),
    check("submissions_payload_sha256_length", sql`octet_length(${table.payloadSha256}) = 32`),
  ],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    currentRevisionId: uuid("current_revision_id"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("articles_slug_unique").on(table.slug),
    uniqueIndex("articles_current_revision_unique").on(table.currentRevisionId),
    index("articles_created_at_idx").on(table.createdAt, table.id),
    foreignKey({
      columns: [table.id, table.currentRevisionId],
      foreignColumns: [revisions.articleId, revisions.id],
      name: "articles_current_revision_same_article_fk",
    }).onDelete("restrict"),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey(),
    articleId: uuid("article_id")
      .notNull()
      .references((): AnyPgColumn => articles.id, { onDelete: "restrict" }),
    parentRevisionId: uuid("parent_revision_id").references(
      (): AnyPgColumn => revisions.id,
      { onDelete: "restrict" },
    ),
    title: text("title").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "restrict" }),
    contentSha256: bytea("content_sha256").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("revisions_submission_unique").on(table.submissionId),
    uniqueIndex("revisions_article_id_id_unique").on(table.articleId, table.id),
    uniqueIndex("revisions_initial_per_article_unique")
      .on(table.articleId)
      .where(sql`${table.parentRevisionId} IS NULL`),
    uniqueIndex("revisions_one_child_per_parent_unique")
      .on(table.parentRevisionId)
      .where(sql`${table.parentRevisionId} IS NOT NULL`),
    index("revisions_article_created_at_idx").on(table.articleId, table.createdAt, table.id),
    index("revisions_content_sha256_idx").on(table.contentSha256),
    index("revisions_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${table.title} || ' ' || ${table.bodyMarkdown})`,
    ),
    check("revisions_content_sha256_length", sql`octet_length(${table.contentSha256}) = 32`),
    foreignKey({
      columns: [table.articleId, table.parentRevisionId],
      foreignColumns: [table.articleId, table.id],
      name: "revisions_parent_same_article_fk",
    }).onDelete("restrict"),
  ],
);

export const submissionOutcomeEvents = pgTable(
  "submission_outcome_events",
  {
    id: uuid("id").primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "restrict" }),
    outcomeCode: text("outcome_code").notNull(),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "restrict" }),
    revisionId: uuid("revision_id").references(() => revisions.id, { onDelete: "restrict" }),
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("submission_outcome_events_submission_idx").on(
      table.submissionId,
      table.createdAt,
      table.id,
    ),
    check(
      "submission_outcome_events_code",
      sql`${table.outcomeCode} IN ('ACCEPTED', 'SUBMISSION_QUARANTINED', 'DUPLICATE_CONTENT', 'REVISION_CONFLICT')`,
    ),
  ],
);

export const revisionStateEvents = pgTable(
  "revision_state_events",
  {
    id: uuid("id").primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    reasonCode: text("reason_code").notNull(),
    actorType: text("actor_type").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("revision_state_events_revision_idx").on(table.revisionId, table.createdAt, table.id),
    check("revision_state_events_state", sql`${table.state} IN ('published', 'quarantined')`),
    check("revision_state_events_actor", sql`${table.actorType} IN ('system', 'admin')`),
  ],
);

export const articleStateEvents = pgTable(
  "article_state_events",
  {
    id: uuid("id").primaryKey(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "restrict" }),
    visibility: text("visibility").notNull(),
    reasonCode: text("reason_code").notNull(),
    actorType: text("actor_type").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("article_state_events_article_idx").on(table.articleId, table.createdAt, table.id),
    check("article_state_events_visibility", sql`${table.visibility} IN ('visible', 'hidden')`),
    check("article_state_events_actor", sql`${table.actorType} IN ('system', 'admin')`),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => pilotCredentials.id, { onDelete: "restrict" }),
    idempotencyKeyDigest: bytea("idempotency_key_digest").notNull(),
    requestDigest: bytea("request_digest").notNull(),
    operation: text("operation").notNull(),
    outcomeCode: text("outcome_code").notNull(),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.credentialId, table.idempotencyKeyDigest] }),
    index("idempotency_records_expires_at_idx").on(table.expiresAt),
    check("idempotency_key_digest_length", sql`octet_length(${table.idempotencyKeyDigest}) = 32`),
    check("idempotency_request_digest_length", sql`octet_length(${table.requestDigest}) = 32`),
  ],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    subjectType: text("subject_type").notNull(),
    subjectDigest: bytea("subject_digest").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.subjectType,
        table.subjectDigest,
        table.windowSeconds,
        table.windowStartedAt,
      ],
    }),
    index("rate_limit_buckets_expires_at_idx").on(table.expiresAt),
    check("rate_limit_buckets_subject_type", sql`${table.subjectType} IN ('credential', 'network')`),
    check("rate_limit_buckets_window_positive", sql`${table.windowSeconds} > 0`),
    check("rate_limit_buckets_count_positive", sql`${table.requestCount} > 0`),
  ],
);

export const systemSettings = pgTable(
  "system_settings",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    readOnly: boolean("read_only").default(false).notNull(),
    settingsVersion: integer("settings_version").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [check("system_settings_singleton_true", sql`${table.singleton} = true`)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    outcomeCode: text("outcome_code").notNull(),
    reasonCode: text("reason_code"),
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_events_request_id_idx").on(table.requestId),
    index("audit_events_created_at_idx").on(table.createdAt),
    check("audit_events_actor_type", sql`${table.actorType} IN ('credential', 'admin', 'system')`),
  ],
);
export const archiveEvents = pgTable(
  "archive_events",
  {
    id: uuid("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    generation: integer("generation").notNull(),
    eventType: text("event_type").notNull(),
    agentIdentifier: text("agent_identifier").notNull(),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    relatedArticleId: uuid("related_article_id").references(() => articles.id, { onDelete: "set null" }),
    safeMetadata: jsonb("safe_metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("archive_events_created_at_idx").on(table.createdAt, table.id),
    index("archive_events_session_idx").on(table.sessionId),
    // One session cannot do the same thing to the same article at the same
    // instant twice. Nothing in the application ever tried to — every write
    // stamps its own `created_at` — but a history backfill was run twice and
    // the table took all 75 rows again without complaint. `coalesce` because a
    // session event carries no article and NULLs would otherwise each count as
    // distinct, which is exactly the rows that were duplicated.
    uniqueIndex("archive_events_no_duplicate_row").on(
      table.sessionId,
      table.eventType,
      sql`coalesce(${table.articleId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.createdAt,
    ),
    check(
      "archive_events_type",
      sql`${table.eventType} IN ('agent_session_started', 'article_opened', 'article_created', 'article_revised', 'wikilinks_created', 'contribution_aborted', 'agent_session_ended')`,
    ),
  ],
);
