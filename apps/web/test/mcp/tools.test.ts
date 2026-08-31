import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentMemoryWikiMcpHandler } from "../../lib/mcp/server";
import { mcpServices, view } from "./support";

const clients: Client[] = [];
afterEach(async () => Promise.all(clients.splice(0).map(async (client) => client.close())));

const clientFor = async (authorization?: string) => {
  const services = mcpServices();
  const handler = createAgentMemoryWikiMcpHandler(services);
  const client = new Client(
    { name: "pilot-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (authorization) request.headers.set("authorization", authorization);
      return handler.fetch(request);
    },
  });
  await client.connect(transport);
  clients.push(client);
  return { client, services };
};

describe("MCP tools", () => {
  it("returns matching text and structured content for public reads", async () => {
    const { client } = await clientFor();
    const result = await client.callTool({ name: "read_article", arguments: { id_or_slug: view.article.slug } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(view);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Cloud") });
  });

  it("forwards opaque cursors through search and optional history reads", async () => {
    const { client, services } = await clientFor();
    await client.callTool({
      name: "search_articles",
      arguments: { query: "cloud", cursor: "YWJj", limit: 7 },
    });
    expect(services.searchArticles).toHaveBeenCalledWith("cloud", {
      cursor: "YWJj",
      limit: 7,
    });

    await client.callTool({
      name: "read_article",
      arguments: {
        id_or_slug: view.article.slug,
        include_history: true,
        history_cursor: "ZGVm",
        history_limit: 3,
      },
    });
    expect(services.listRevisions).toHaveBeenCalledWith(view.article.slug, {
      cursor: "ZGVm",
      limit: 3,
    });
  });

  it("rejects unknown input keys through the shared strict schema", async () => {
    const { client } = await clientFor();
    const result = await client.callTool({ name: "about", arguments: { injected: true } });
    expect(result.isError).toBe(true);
  });

  it("rejects database-unsafe string characters at the MCP boundary", async () => {
    const { client, services } = await clientFor("Bearer pilot_abcd.secretsecretsecretsecret");
    const result = await client.callTool({
      name: "create_article",
      arguments: {
        idempotency_key: "1234567890abcdef",
        title: "Unsafe\0title",
        body_markdown: "Body",
        identity: { claimed_agent_name: "agent" },
      },
    });
    expect(result.isError).toBe(true);
    expect(services.createArticle).not.toHaveBeenCalled();
  });

  it("allows open writes without requiring bearer credential", async () => {
    const { client, services } = await clientFor();
    const result = await client.callTool({
      name: "create_article",
      arguments: { idempotency_key: "1234567890abcdef", title: "Cloud", body_markdown: "Body\n", identity: { claimed_agent_name: "agent" } },
    });
    expect(result.isError).not.toBe(true);
    expect(services.createArticle).toHaveBeenCalled();
  });

  it("passes exact write input to the same application service", async () => {
    const { client, services } = await clientFor("Bearer pilot_abcd.secretsecretsecretsecret");
    const input = { idempotency_key: "1234567890abcdef", title: "  Nuvola ☁️  ", body_markdown: "Corpo\n", identity: { claimed_agent_name: "agent" } };
    const result = await client.callTool({ name: "create_article", arguments: input });
    expect(result.isError).not.toBe(true);
    expect(services.createArticle).toHaveBeenCalledWith(expect.objectContaining({ method: "mcp", rawSubmission: { title: input.title, body_markdown: input.body_markdown, identity: input.identity } }));
    expect(services.getRawRevision).toHaveBeenCalledWith(view.article.id, view.revision.id);
  });

  it("maps internal dependency codes to the safe public allowlist", async () => {
    const services = mcpServices();
    services.createArticle = async () => {
      const error = new Error("private database detail") as Error & { code: string };
      error.code = "23505";
      throw error;
    };
    const handler = createAgentMemoryWikiMcpHandler(services);
    const client = new Client(
      { name: "pilot-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        request.headers.set("authorization", "Bearer pilot_abcd.secretsecretsecretsecret");
        return handler.fetch(request);
      },
    });
    await client.connect(transport);
    clients.push(client);

    const result = await client.callTool({
      name: "create_article",
      arguments: {
        idempotency_key: "1234567890abcdef",
        title: "Cloud",
        body_markdown: "Body\n",
        identity: { claimed_agent_name: "agent" },
      },
    });
    expect(JSON.stringify(result)).toContain("DEPENDENCY_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("23505");
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  it("sanitizes failures from every public read tool", async () => {
    const services = mcpServices();
    const failure = async () => {
      const error = new Error("private read query detail") as Error & { code: string };
      error.code = "42P01";
      throw error;
    };
    services.about = failure;
    services.listArticles = failure;
    services.searchArticles = failure;
    services.getArticle = failure;

    const handler = createAgentMemoryWikiMcpHandler(services);
    const client = new Client(
      { name: "pilot-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    });
    await client.connect(transport);
    clients.push(client);

    for (const request of [
      { name: "about", arguments: {} },
      { name: "list_articles", arguments: {} },
      { name: "search_articles", arguments: { query: "cloud" } },
      { name: "read_article", arguments: { id_or_slug: "cloud" } },
    ]) {
      const result = await client.callTool(request);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("DEPENDENCY_UNAVAILABLE");
      expect(JSON.stringify(result)).not.toContain("42P01");
      expect(JSON.stringify(result)).not.toContain("private read query detail");
    }
  });
});
