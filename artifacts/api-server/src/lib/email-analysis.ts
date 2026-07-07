import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

export interface EmailAnalysis {
  signalScore: number;
  category: "signal" | "noise";
  summary: string;
  topics: string[];
  actionItems: Array<{ text: string; deadline: string | null; priority: "high" | "medium" | "low" }>;
  entities: Array<{ name: string; type: "person" | "company" | "topic" | "org" }>;
}

export async function analyzeEmail(
  subject: string,
  fromName: string,
  fromEmail: string,
  bodyText: string
): Promise<EmailAnalysis> {
  const prompt = `Analyze this email for signal vs noise. Return a JSON object only, no markdown.

From: ${fromName} <${fromEmail}>
Subject: ${subject}
Body (first 2000 chars):
${bodyText.slice(0, 2000)}

Return this exact JSON structure:
{
  "signalScore": <integer 0-100, where 100=pure signal requiring attention, 0=pure noise/marketing>,
  "category": <"signal" if score>=60, else "noise">,
  "summary": <1-2 sentence summary of what this email is actually about>,
  "topics": <array of 1-4 topic strings, lowercase, e.g. ["product launch", "quarterly review"]>,
  "actionItems": <array of objects {text: string, deadline: string|null, priority: "high"|"medium"|"low"} - only real tasks/decisions required of the recipient, empty array if none>,
  "entities": <array of {name: string, type: "person"|"company"|"topic"|"org"} - key named entities mentioned>
}

Signal scoring guide:
- 80-100: Requires immediate action, decision, or response; time-sensitive; from a key person
- 60-79: Worth reading; contains useful information or a soft request; from known/relevant sender
- 40-59: Informational; newsletters with genuinely useful content; conference invites
- 20-39: Low-value newsletters; automated reports; status updates with no action needed
- 0-19: Marketing email; promotional; spam; unsubscribe noise`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 512,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as Partial<EmailAnalysis>;
    return {
      signalScore: Math.min(100, Math.max(0, parsed.signalScore ?? 0)),
      category: (parsed.signalScore ?? 0) >= 60 ? "signal" : "noise",
      summary: parsed.summary ?? "No summary available.",
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 5) : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.slice(0, 5) : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 10) : [],
    };
  } catch (err) {
    logger.warn({ err, raw }, "Failed to parse email analysis JSON");
    return {
      signalScore: 0,
      category: "noise",
      summary: "Analysis unavailable.",
      topics: [],
      actionItems: [],
      entities: [],
    };
  }
}
