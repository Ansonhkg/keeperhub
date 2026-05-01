import postgres from "postgres";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/db");
vi.unmock("@/lib/db/schema");

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("agentic builder database adapters", () => {
  const runId = `builder-db-${Date.now()}`;
  const userId = `${runId}-user`;
  const organizationId = `${runId}-org`;
  const sessionId = `${runId}-session`;

  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
    try {
      await sql`create table if not exists users (
        id text primary key,
        name text,
        email text unique,
        email_verified boolean not null default false,
        image text,
        created_at timestamp not null default now(),
        updated_at timestamp not null default now(),
        is_anonymous boolean default false,
        deactivated_at timestamp
      )`;
      await sql`create table if not exists organization (
        id text primary key,
        name text not null,
        slug text not null unique,
        logo text,
        created_at timestamp not null default now(),
        metadata text
      )`;
      await sql`create table if not exists builder_sessions (
        id text primary key,
        user_id text not null,
        organization_id text not null,
        prompt text not null,
        status text not null,
        dag jsonb not null,
        turns jsonb not null,
        catalog_candidates jsonb not null,
        options jsonb not null,
        questions jsonb not null,
        feature_requests jsonb not null,
        created_at timestamp not null default now(),
        updated_at timestamp not null default now()
      )`;
      await sql`create table if not exists workflows (
        id text primary key,
        name text not null,
        description text,
        user_id text not null,
        organization_id text,
        is_anonymous boolean not null default false,
        nodes jsonb not null,
        edges jsonb not null,
        created_at timestamp not null default now(),
        updated_at timestamp not null default now()
      )`;
      await sql`create table if not exists builder_materializations (
        id text primary key,
        session_id text not null,
        organization_id text not null,
        idempotency_key text not null,
        workflow_id text not null,
        mode text not null,
        input_hash text not null,
        revision bigint not null,
        created_at timestamp not null default now()
      )`;
      await sql`create unique index if not exists idx_builder_materializations_idempotency
        on builder_materializations (organization_id, session_id, idempotency_key, input_hash)`;
      await sql`insert into users (id, name, email, email_verified, created_at, updated_at)
        values (${userId}, 'Builder DB Test', ${`${userId}@example.test`}, true, now(), now())
        on conflict (id) do nothing`;
      await sql`insert into organization (id, name, slug, created_at)
        values (${organizationId}, 'Builder DB Test', ${organizationId}, now())
        on conflict (id) do nothing`;
      await sql`insert into builder_sessions (
        id, user_id, organization_id, prompt, status, dag, turns,
        catalog_candidates, options, questions, feature_requests
      ) values (
        ${sessionId}, ${userId}, ${organizationId}, 'Track ETH', 'ready',
        ${sql.json({ commits: [], branches: [], id: sessionId, revision: 0, schemaVersion: 1 })},
        ${sql.json([])}, ${sql.json([])}, ${sql.json([])}, ${sql.json([])}, ${sql.json([])}
      ) on conflict (id) do nothing`;
    } finally {
      await sql.end();
    }
  });

  it("round-trips materialization idempotency through Postgres", async () => {
    const { createKeeperHubWorkflowMaterializer } = await import(
      "@/lib/agentic-builder/keeperhub-materializer"
    );
    const materializer = createKeeperHubWorkflowMaterializer();
    const input = {
      auth: {
        actorType: "user" as const,
        organizationId,
        scopes: ["builder:write"],
        userId,
      },
      idempotencyKey: "idem-db-1",
      mode: "create" as const,
      name: "DB ETH alert",
      projection: {
        candidateBranches: [],
        committed: {
          edges: [],
          id: sessionId,
          nodes: [
            {
              dependsOn: [],
              id: "step-db-1",
              kind: "trigger" as const,
              label: "Run every 15 minutes",
              requiredEntityIds: [],
              status: "ready" as const,
            },
          ],
        },
        headCommitId: "commit-db-1",
        options: [],
        questions: [],
        sessionId,
        timeline: [],
        validation: { issues: [], valid: true },
      },
      session: { id: sessionId },
    };

    const [first, second] = await Promise.all([
      materializer.materialize(input as never),
      materializer.materialize(input as never),
    ]);

    expect(first.workflowId).toBe(second.workflowId);
    const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
    try {
      const materializations = await sql`
        select count(*)::int as count
        from builder_materializations
        where organization_id = ${organizationId}
          and session_id = ${sessionId}
          and idempotency_key = 'idem-db-1'
      `;
      const workflows = await sql`
        select count(*)::int as count
        from workflows
        where id = ${first.workflowId}
      `;
      expect(materializations[0]?.count).toBe(1);
      expect(workflows[0]?.count).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
