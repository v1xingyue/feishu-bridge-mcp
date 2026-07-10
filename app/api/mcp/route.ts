import { authorized } from "@/lib/auth";
import { handleRpc } from "@/lib/mcp";

export const runtime = "nodejs";

const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "POST, OPTIONS",
};

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers });
  }
  const response = await handleRpc(body);
  return response ? Response.json(response, { headers }) : new Response(null, { status: 202, headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
