const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function encodeState(payload) {
  return btoa(JSON.stringify(payload));
}

function decodeState(value) {
  try {
    return JSON.parse(atob(value));
  } catch {
    return null;
  }
}

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  const allowed = getAllowedOrigins(env);
  return allowed.length > 0 && allowed.includes(origin);
}

function callbackUrl(url) {
  return `${url.origin}/callback`;
}

function popupMessage(origin, payload) {
  const serialized = JSON.stringify(payload);
  return `<!DOCTYPE html>
<html>
  <body>
    <script>
      (function () {
        const targetOrigin = ${JSON.stringify(origin)};
        const payload = ${JSON.stringify(serialized)};
        if (window.opener) {
          window.opener.postMessage("authorization:github:success:" + payload, targetOrigin);
        }
        window.close();
      })();
    </script>
    Authorized. You can close this window.
  </body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html>
  <body>
    <h1>OAuth error</h1>
    <p>${message}</p>
  </body>
</html>`;
}

async function exchangeCodeForToken({ code, redirectUri, env }) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "tnc-decap-oauth-proxy",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "Could not exchange code for token.");
  }

  return data.access_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      const origin = url.searchParams.get("origin");
      const state = url.searchParams.get("state") || crypto.randomUUID();
      const scope = url.searchParams.get("scope") || "repo";

      if (!origin || !isAllowedOrigin(origin, env)) {
        return htmlResponse(errorPage("Origin is missing or not allowed."), 400);
      }

      const outbound = new URL(GITHUB_AUTHORIZE_URL);
      outbound.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      outbound.searchParams.set("redirect_uri", callbackUrl(url));
      outbound.searchParams.set("scope", scope);
      outbound.searchParams.set(
        "state",
        encodeState({
          state,
          origin,
        }),
      );

      return Response.redirect(outbound.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const encodedState = url.searchParams.get("state");
      const decoded = encodedState ? decodeState(encodedState) : null;

      if (!code || !decoded?.origin || !isAllowedOrigin(decoded.origin, env)) {
        return htmlResponse(errorPage("Missing OAuth callback data."), 400);
      }

      try {
        const token = await exchangeCodeForToken({
          code,
          redirectUri: callbackUrl(url),
          env,
        });

        return htmlResponse(
          popupMessage(decoded.origin, {
            token,
            provider: "github",
          }),
        );
      } catch (error) {
        return htmlResponse(errorPage(error.message), 500);
      }
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
};
