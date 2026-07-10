import { createHmac, timingSafeEqual } from "node:crypto";

const AUDIENCE = "feishu-mcp";
export const MCP_TOKEN_DAYS = [30, 180, 360] as const;
export const MCP_TOKEN_TTL = 60 * 60 * 24 * 30;

export function mcpTokenTtl(days: unknown) {
  const value = Number(days);
  return MCP_TOKEN_DAYS.includes(value as typeof MCP_TOKEN_DAYS[number]) ? value * 60 * 60 * 24 : 0;
}

export function signMcpToken(subject: string, expiresIn = MCP_TOKEN_TTL) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: subject, aud: AUDIENCE, iat: now, exp: now + expiresIn });
  return `${header}.${payload}.${signature(`${header}.${payload}`)}`;
}

export function verifyMcpToken(token?: string) {
  return Boolean(mcpTokenSubject(token));
}

function mcpTokenSubject(token?: string) {
  if (!token) return undefined;
  try {
    const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart || extra) return undefined;
    const expected = Buffer.from(signature(`${headerPart}.${payloadPart}`), "base64url");
    const actual = Buffer.from(signaturePart, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
    return header.alg === "HS256" && header.typ === "JWT" && payload.aud === AUDIENCE && typeof payload.sub === "string" && typeof payload.exp === "number" && payload.exp > Date.now() / 1000 ? payload.sub as string : undefined;
  } catch { return undefined; }
}

export function authorized(request: Request) {
  return isAdminOpenId(mcpTokenSubject(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")));
}

export function isAdminOpenId(openId?: string) { return Boolean(openId && ids("FEISHU_ADMIN_OPEN_IDS").has(openId)); }
export function isAllowedOpenId(openId?: string) { return Boolean(openId && (isAdminOpenId(openId) || ids("FEISHU_ALLOWED_OPEN_IDS").has(openId))); }
export function sessionOpenId(session: unknown) { return (session as { user?: { openId?: string } } | null)?.user?.openId; }

function ids(name: string) { return new Set((process.env[name] || "").split(/[,\s]+/).filter(Boolean)); }

function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function signature(value: string) {
  const secret = process.env.MCP_JWT_SECRET;
  if (!secret) throw new Error("缺少 MCP_JWT_SECRET");
  // ponytail: stateless tokens; add a jti denylist only if per-token revocation is needed.
  return createHmac("sha256", secret).update(value).digest("base64url");
}
