import { db, oauthTokens } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    }>;
  };
  internalDate?: string;
}

export interface ParsedEmail {
  gmailId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: Date;
  bodyText: string;
  snippet: string;
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64(encoded: string): string {
  try {
    return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(payload: GmailMessage["payload"]): string {
  if (!payload) return "";

  function findPart(parts: NonNullable<GmailMessage["payload"]>["parts"]): string {
    if (!parts) return "";
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64(part.body.data);
      if (part.parts) {
        const nested = findPart(part.parts);
        if (nested) return nested;
      }
    }
    return "";
  }

  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) return findPart(payload.parts);
  return "";
}

async function getAccessToken(): Promise<string> {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"))
    .limit(1);

  if (rows.length === 0) {
    throw new Error(
      "401: Gmail not connected. Open Signal vs. Noise and click Connect Gmail to authorize."
    );
  }

  const row = rows[0];
  const needsRefresh =
    row.expiresAt && row.expiresAt < new Date(Date.now() + 60_000);

  if (needsRefresh && row.refreshToken) {
    logger.info("Refreshing Google access token");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: row.refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
      }),
    });

    const refreshed = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (refreshed.error || !refreshed.access_token) {
      throw new Error(`401: Token refresh failed — please reconnect Gmail.`);
    }

    const expiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : null;

    await db
      .update(oauthTokens)
      .set({ accessToken: refreshed.access_token, expiresAt, updatedAt: new Date() })
      .where(eq(oauthTokens.provider, "google"));

    return refreshed.access_token;
  }

  return row.accessToken;
}

export async function listMessageIds(query = "in:inbox", maxResults = 20): Promise<string[]> {
  const token = await getAccessToken();
  const url = `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail list failed ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { messages?: Array<{ id: string }> };
  return (data.messages ?? []).map((m) => m.id);
}

export async function getMessage(messageId: string): Promise<ParsedEmail> {
  const token = await getAccessToken();
  const url = `${GMAIL_BASE}/messages/${messageId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok) {
    throw new Error(`Gmail get message failed ${res.status}`);
  }

  const msg = (await res.json()) as GmailMessage;
  const headers = msg.payload?.headers ?? [];
  const fromRaw = getHeader(headers, "From");
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const dateHeader = getHeader(headers, "Date");

  let fromName = fromRaw;
  let fromEmail = fromRaw;
  const match = fromRaw.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/);
  if (match) {
    fromName = match[1].trim() || match[2].trim();
    fromEmail = match[2].trim() || match[1].trim();
  }

  const bodyText = extractBody(msg.payload) || msg.snippet;
  const date = msg.internalDate
    ? new Date(parseInt(msg.internalDate, 10))
    : new Date(dateHeader || Date.now());

  return {
    gmailId: msg.id,
    from: fromRaw,
    fromName,
    fromEmail,
    subject,
    date,
    bodyText: bodyText.slice(0, 3000),
    snippet: msg.snippet ?? "",
  };
}
