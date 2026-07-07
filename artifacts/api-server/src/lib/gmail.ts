import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

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

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64(encoded: string): string {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(payload: GmailMessage["payload"]): string {
  if (!payload) return "";

  function findPart(parts: NonNullable<GmailMessage["payload"]>["parts"]): string {
    if (!parts) return "";
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      if (part.parts) {
        const nested = findPart(part.parts);
        if (nested) return nested;
      }
    }
    return "";
  }

  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    const text = findPart(payload.parts);
    if (text) return text;
  }
  return "";
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

export async function listMessageIds(query = "in:inbox", maxResults = 20): Promise<string[]> {
  const connectors = new ReplitConnectors();
  const url = `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const res = await connectors.proxy("google-mail", url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail list failed ${res.status}: ${text}`);
  }
  const data = await res.json() as { messages?: Array<{ id: string }> };
  return (data.messages ?? []).map((m) => m.id);
}

export async function getMessage(messageId: string): Promise<ParsedEmail> {
  const connectors = new ReplitConnectors();
  const url = `/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await connectors.proxy("google-mail", url);
  if (!res.ok) {
    throw new Error(`Gmail get message failed ${res.status}`);
  }
  const msg = await res.json() as GmailMessage;

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
  const date = msg.internalDate ? new Date(parseInt(msg.internalDate, 10)) : new Date(dateHeader || Date.now());

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
