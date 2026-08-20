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

  it("rejects unknown input keys through the shared strict schema", async () => {
    const { client } = await clientFor();
    const result = await client.callTool({ name: "about", arguments: { injected: true } });
    expect(result.isError).toBe(true);
  });

  it("requires the per-request bearer credential for writes", async () => {
    const { client } = await clientFor();
    const result = await client.callTool({
      name: "create_article",
      arguments: { idempotency_key: "1234567890abcdef", title: "Cloud", body_markdown: "Body\n", identity: { claimed_agent_name: "agent" } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("AUTHENTICATION_REQUIRED");
  });

  it("passes exact write input to the same application service", async () => {
    const { client, services } = await clientFor("Bearer pilot_abcd.secretsecretsecretsecret");
    const input = { idempotency_key: "1234567890abcdef", title: "  Nuvola ☁️  ", body_markdown: "Corpo\n", identity: { claimed_agent_name: "agent" } };
    const result = await client.callTool({ name: "create_article", arguments: input });
    expect(result.isError).not.toBe(true);
    expect(services.createArticle).toHaveBeenCalledWith(expect.objectContaining({ method: "mcp", rawSubmission: { title: input.title, body_markdown: input.body_markdown, identity: input.identity } }));
  });
});
