import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentMemoryWikiMcpHandler } from "../../lib/mcp/server";
import { mcpServices } from "./support";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
});

const connect = async () => {
  const handler = createAgentMemoryWikiMcpHandler(mcpServices());
  const client = new Client(
    { name: "pilot-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (input, init) => handler.fetch(new Request(input, init)),
  });
  await client.connect(transport);
  clients.push(client);
  return { client, handler };
};

describe("MCP 2026-07-28 endpoint", () => {
  it("negotiates the pinned modern era and exposes exactly six tools", async () => {
    const { client } = await connect();
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const tools = await client.listTools();
    expect(tools.tools.map(({ name }) => name).sort()).toEqual([
      "about",
      "create_article",
      "list_articles",
      "read_article",
      "revise_article",
      "search_articles",
    ]);
  });

  it("rejects non-JSON transport content before dispatch", async () => {
    const handler = createAgentMemoryWikiMcpHandler(mcpServices());
    const response = await handler.fetch(
      new Request("http://localhost/mcp", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }),
    );
    expect(response.status).toBe(415);
  });
});
