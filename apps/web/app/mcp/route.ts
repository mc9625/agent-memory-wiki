import { hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";

import { getHttpServices } from "../../lib/http/runtime";
import { readBoundedBody } from "../../lib/http/bounded-body";
import { createAgentMemoryWikiMcpHandler } from "../../lib/mcp/server";

export const dynamic = "force-dynamic";

let handlerPromise: ReturnType<typeof buildHandler> | undefined;
const buildHandler = async () => createAgentMemoryWikiMcpHandler(await getHttpServices());

const allowedValues = (name: string, local: readonly string[]): string[] => {
  const configured = process.env[name]?.split(",").map((value) => value.trim()).filter(Boolean);
  return configured && configured.length > 0 ? configured : [...local];
};

export const POST = async (request: Request): Promise<Response> => {
  const hostFailure = hostHeaderValidationResponse(
    request,
    allowedValues("MCP_ALLOWED_HOSTS", ["localhost", "127.0.0.1"]),
  );
  if (hostFailure) return hostFailure;
  const originFailure = originValidationResponse(
    request,
    allowedValues("MCP_ALLOWED_ORIGINS", ["http://localhost", "http://127.0.0.1"]),
  );
  if (originFailure) return originFailure;
  const body = await readBoundedBody(request, 32_768);
  if (!body.ok) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  const boundedRequest = new Request(request.url, {
    body: body.bytes.buffer.slice(
      body.bytes.byteOffset,
      body.bytes.byteOffset + body.bytes.byteLength,
    ) as ArrayBuffer,
    headers: request.headers,
    method: request.method,
  });
  handlerPromise ??= buildHandler();
  return (await handlerPromise).fetch(boundedRequest);
};
