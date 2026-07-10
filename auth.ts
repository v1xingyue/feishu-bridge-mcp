import { oauthProfile } from "@/lib/feishu";
import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

const BASE = "https://open.feishu.cn/open-apis";
const SCOPES = "contact:user.base:readonly";

process.env.AUTH_TRUST_HOST ||= "true";

type FeishuProfile = { open_id: string; name?: string; en_name?: string; email?: string; enterprise_email?: string; avatar_url?: string };

function credentials() {
  const clientId = process.env.FEISHU_APP_ID || process.env.FEISHU_APP_KEY;
  const clientSecret = process.env.FEISHU_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error("缺少飞书应用凭据");
  return { clientId, clientSecret };
}

async function appAccessToken() {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(`${BASE}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: clientId, app_secret: clientSecret }),
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.msg || "获取飞书 app_access_token 失败");
  return body.app_access_token as string;
}

async function userToken(path: string, payload: Record<string, string>) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await appAccessToken()}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.msg || "飞书 OAuth token 请求失败");
  return body.data as { access_token: string; expires_in?: number; scope?: string; token_type?: string };
}

function FeishuProvider(): OAuthConfig<FeishuProfile> {
  const { clientId, clientSecret } = credentials();
  return {
    id: "feishu",
    name: "飞书",
    type: "oauth",
    clientId,
    clientSecret,
    checks: ["state"],
    authorization: { url: "https://accounts.feishu.cn/open-apis/authen/v1/authorize", params: { app_id: clientId, scope: SCOPES } },
    token: {
      async request({ params }) {
        if (!params.code) throw new Error("飞书未返回 authorization code");
        const data = await userToken("/authen/v1/oidc/access_token", { grant_type: "authorization_code", code: params.code });
        return { tokens: { access_token: data.access_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 7200), token_type: data.token_type || "Bearer", scope: data.scope } };
      },
    },
    userinfo: {
      async request({ tokens }) {
        const response = await fetch(`${BASE}/authen/v1/user_info`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
        const body = await response.json();
        if (!response.ok || body.code !== 0) throw new Error(body.msg || "读取飞书用户信息失败");
        return body.data;
      },
    },
    profile: oauthProfile,
  };
}

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET || process.env.MCP_ACCESS_KEY,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  providers: [FeishuProvider()],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) token.openId = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        (session.user as typeof session.user & { openId?: string }).openId = token.openId as string | undefined;
      }
      return session;
    },
  },
};
