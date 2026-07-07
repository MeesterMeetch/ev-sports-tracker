import { Router } from "express";
import type { IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, emailSignals, actionItems, emailEntities } from "@workspace/db";
import { listMessageIds, getMessage } from "../lib/gmail";
import { analyzeEmail } from "../lib/email-analysis";

const router: IRouter = Router();

function formatSignal(s: typeof emailSignals.$inferSelect) {
  return {
    id: s.id,
    gmailId: s.gmailId,
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    subject: s.subject,
    date: s.date.toISOString(),
    bodySnippet: s.bodySnippet,
    signalScore: s.signalScore,
    category: s.category,
    summary: s.summary,
    topics: s.topics,
    processedAt: s.processedAt.toISOString(),
  };
}

function formatAction(a: typeof actionItems.$inferSelect) {
  return {
    id: a.id,
    emailId: a.emailId,
    text: a.text,
    deadline: a.deadline ?? null,
    priority: a.priority,
    done: a.done,
    createdAt: a.createdAt.toISOString(),
  };
}

router.post("/email/sync", async (req, res): Promise<void> => {
  const start = Date.now();
  const maxEmails = parseInt(req.body?.maxEmails ?? "20", 10) || 20;
  const query = req.body?.query ?? "in:inbox";

  let processed = 0;
  let skipped = 0;
  let newSignals = 0;
  let newActions = 0;

  try {
    const ids = await listMessageIds(query, Math.min(maxEmails, 50));

    for (const gmailId of ids) {
      try {
        const existing = await db
          .select({ id: emailSignals.id })
          .from(emailSignals)
          .where(eq(emailSignals.gmailId, gmailId))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const email = await getMessage(gmailId);
        const analysis = await analyzeEmail(
          email.subject,
          email.fromName,
          email.fromEmail,
          email.bodyText
        );

        const [signal] = await db
          .insert(emailSignals)
          .values({
            gmailId: email.gmailId,
            fromName: email.fromName,
            fromEmail: email.fromEmail,
            subject: email.subject,
            date: email.date,
            bodySnippet: email.snippet.slice(0, 300),
            signalScore: analysis.signalScore,
            category: analysis.category,
            summary: analysis.summary,
            topics: analysis.topics,
          })
          .returning();

        if (analysis.category === "signal") newSignals++;
        processed++;

        for (const item of analysis.actionItems) {
          await db.insert(actionItems).values({
            emailId: signal.id,
            text: item.text,
            deadline: item.deadline ?? null,
            priority: item.priority,
            done: false,
          });
          newActions++;
        }

        for (const entity of analysis.entities) {
          await db.insert(emailEntities).values({
            emailId: signal.id,
            name: entity.name,
            type: entity.type,
          }).onConflictDoNothing();
        }
      } catch (err) {
        req.log.warn({ err, gmailId }, "Failed to process email");
        skipped++;
      }
    }

    res.json({
      processed,
      skipped,
      newSignals,
      newActions,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    req.log.error({ err }, "Email sync failed");
    res.status(500).json({ error: String(err) });
  }
});

router.get("/email/signals", async (req, res): Promise<void> => {
  const category = typeof req.query.category === "string" ? req.query.category : "all";
  const minScore = req.query.minScore ? parseInt(req.query.minScore as string, 10) : 0;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  let rows = await db.select().from(emailSignals).orderBy(desc(emailSignals.signalScore));

  if (category !== "all") rows = rows.filter((r) => r.category === category);
  if (minScore > 0) rows = rows.filter((r) => r.signalScore >= minScore);

  res.json(rows.slice(0, limit).map(formatSignal));
});

router.get("/email/actions", async (req, res): Promise<void> => {
  const doneFilter = req.query.done;
  let rows = await db.select().from(actionItems).orderBy(actionItems.priority, desc(actionItems.createdAt));

  if (doneFilter === "true") rows = rows.filter((r) => r.done);
  else if (doneFilter === "false") rows = rows.filter((r) => !r.done);

  res.json(rows.map(formatAction));
});

router.patch("/email/actions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { done, text, deadline, priority } = req.body ?? {};
  const updateData: Record<string, unknown> = {};
  if (done !== undefined) updateData.done = Boolean(done);
  if (text !== undefined) updateData.text = text;
  if (deadline !== undefined) updateData.deadline = deadline;
  if (priority !== undefined) updateData.priority = priority;

  const [updated] = await db
    .update(actionItems)
    .set(updateData)
    .where(eq(actionItems.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(formatAction(updated));
});

router.get("/email/entities", async (req, res): Promise<void> => {
  const typeFilter = typeof req.query.type === "string" ? req.query.type : null;

  const rows = await db
    .select({
      name: emailEntities.name,
      type: emailEntities.type,
      count: sql<number>`count(*)::int`,
    })
    .from(emailEntities)
    .groupBy(emailEntities.name, emailEntities.type)
    .orderBy(desc(sql`count(*)`));

  const filtered = typeFilter ? rows.filter((r) => r.type === typeFilter) : rows;
  res.json(filtered.slice(0, 100));
});

router.get("/email/trends", async (req, res): Promise<void> => {
  const all = await db.select().from(emailSignals).orderBy(desc(emailSignals.processedAt)).limit(200);

  const topicMap = new Map<string, { count: number; emails: string[] }>();
  for (const signal of all) {
    for (const topic of signal.topics) {
      if (!topicMap.has(topic)) topicMap.set(topic, { count: 0, emails: [] });
      const t = topicMap.get(topic)!;
      t.count++;
      if (t.emails.length < 4) t.emails.push(signal.subject);
    }
  }

  const trends = Array.from(topicMap.entries())
    .map(([topic, { count, emails }]) => ({ topic, count, recentEmails: emails }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  res.json(trends);
});

router.get("/email/stats", async (req, res): Promise<void> => {
  const [signals, actions] = await Promise.all([
    db.select().from(emailSignals),
    db.select().from(actionItems).where(eq(actionItems.done, false)),
  ]);

  const total = signals.length;
  const signalCount = signals.filter((s) => s.category === "signal").length;
  const noise = total - signalCount;
  const signalRate = total > 0 ? Math.round((signalCount / total) * 1000) / 10 : 0;
  const avgSignalScore =
    total > 0 ? Math.round(signals.reduce((sum, s) => sum + s.signalScore, 0) / total) : 0;

  const senderMap = new Map<string, { fromName: string; count: number; totalScore: number }>();
  for (const s of signals) {
    if (!senderMap.has(s.fromEmail)) {
      senderMap.set(s.fromEmail, { fromName: s.fromName, count: 0, totalScore: 0 });
    }
    const e = senderMap.get(s.fromEmail)!;
    e.count++;
    e.totalScore += s.signalScore;
  }

  const topSenders = Array.from(senderMap.entries())
    .map(([fromEmail, { fromName, count, totalScore }]) => ({
      fromEmail,
      fromName,
      count,
      avgScore: Math.round(totalScore / count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    total,
    signals: signalCount,
    noise,
    signalRate,
    avgSignalScore,
    pendingActions: actions.length,
    topSenders,
  });
});

export default router;
