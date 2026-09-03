import { VercelRequest, VercelResponse } from "@vercel/node";
import { getClient, createAuthorizationCode } from "../../src/oauth.js";
import { verifyAdminLoginAndGetAgentId } from "../../src/admin-login.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderLoginPage(params: Record<string, string>, error?: string) {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sign in - Regent MCP</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #0b0c10; color: #eaeaea;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    form { background: #16181d; padding: 32px; border-radius: 12px; width: 320px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p.sub { color: #9a9a9a; font-size: 13px; margin: 0 0 20px; }
    label { display: block; font-size: 13px; margin-bottom: 6px; color: #cfcfcf; }
    input[type=email], input[type=password] {
      width: 100%; padding: 10px 12px; margin-bottom: 14px; border-radius: 8px;
      border: 1px solid #303341; background: #0e0f13; color: #fff; box-sizing: border-box;
    }
    button { width: 100%; padding: 10px; border-radius: 8px; border: none; background: #5b8cff;
             color: white; font-weight: 600; cursor: pointer; }
    .error { background: #3a1a1a; color: #ffb4b4; padding: 8px 10px; border-radius: 8px;
             font-size: 13px; margin-bottom: 14px; }
  </style>
</head>
<body>
  <form method="POST" action="/api/oauth/authorize">
    <h1>Regent Website MCP</h1>
    <p class="sub">Sign in with your admin account to authorize this connection.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    ${hidden}
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

type AuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
};

function extractParams(source: Record<string, any>): AuthorizeParams {
  return {
    response_type: source.response_type,
    client_id: source.client_id,
    redirect_uri: source.redirect_uri,
    state: source.state,
    code_challenge: source.code_challenge,
    code_challenge_method: source.code_challenge_method || "S256",
    scope: source.scope,
  };
}

async function validateAgainstClient(params: AuthorizeParams): Promise<string | null> {
  if (params.response_type !== "code") return "Only response_type=code is supported.";
  if (!params.client_id || !params.redirect_uri || !params.code_challenge) {
    return "Missing required OAuth parameters.";
  }
  const client = await getClient(params.client_id);
  if (!client) return "Unknown client_id. Try reconnecting the connector.";
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return "redirect_uri does not match the one registered for this client.";
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const params = extractParams(req.query as Record<string, any>);
    const validationError = await validateAgainstClient(params);
    if (validationError) {
      res.status(400).send(validationError);
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(renderLoginPage(params as any));
    return;
  }

  if (req.method === "POST") {
    const body = (req as any).body || {};
    const params = extractParams(body);
    const validationError = await validateAgainstClient(params);
    if (validationError) {
      res.status(400).send(validationError);
      return;
    }

    const agentId = await verifyAdminLoginAndGetAgentId(body.email, body.password);
    if (!agentId) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(401).send(renderLoginPage(params as any, "Incorrect email or password."));
      return;
    }

    const code = await createAuthorizationCode({
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      scope: params.scope,
      agent_id: agentId,
    });

    const redirect = new URL(params.redirect_uri);
    redirect.searchParams.set("code", code);
    if (params.state) redirect.searchParams.set("state", params.state);

    res.writeHead(302, { Location: redirect.toString() });
    res.end();
    return;
  }

  res.status(405).json({ error: "method_not_allowed" });
}
