import { Router, type IRouter } from "express";
import { db, oauthTokens } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function buildRedirectUri(req: Parameters<Parameters<typeof router.get>[1]>[0]): string {
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ||
    (req.headers.host as string | undefined) ||
    "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) || "https";
  return `${proto}://${host}/api/auth/google/callback`;
}

router.get("/auth/google", (req, res): void => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("GOOGLE_CLIENT_ID is not configured.");
    return;
  }
  const redirectUri = buildRedirectUri(req);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  res.redirect(url.toString());
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const code = req.query["code"] as string | undefined;
  if (!code) {
    res.status(400).send("Missing code parameter.");
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).send("Google OAuth credentials not configured.");
    return;
  }

  const redirectUri = buildRedirectUri(req);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (tokens.error || !tokens.access_token) {
      throw new Error(tokens.error_description ?? tokens.error ?? "Token exchange failed");
    }

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    await db
      .insert(oauthTokens)
      .values({
        provider: "google",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
        scope: tokens.scope ?? GMAIL_SCOPE,
      })
      .onConflictDoUpdate({
        target: oauthTokens.provider,
        set: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt,
          scope: tokens.scope ?? GMAIL_SCOPE,
          updatedAt: new Date(),
        },
      });

    logger.info("Google OAuth token stored successfully");
    res.redirect("/signal/");
  } catch (err) {
    logger.error({ err }, "Google OAuth callback failed");
    res.redirect("/signal/?auth_error=1");
  }
});

router.get("/auth/google/status", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"))
    .limit(1);

  if (rows.length === 0) {
    res.json({ connected: false });
    return;
  }

  const row = rows[0];
  const tokenExpired =
    row.expiresAt && row.expiresAt < new Date() && !row.refreshToken;

  res.json({ connected: !tokenExpired, expiresAt: row.expiresAt });
});

export default router;
