import { Router } from "express";
import type { IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, betsTable } from "@workspace/db";
import {
  CreateBetBody,
  UpdateBetBody,
  UpdateBetParams,
  DeleteBetParams,
} from "@workspace/api-zod";
import { americanToImpliedProb } from "../lib/ev-math";

const router: IRouter = Router();

function formatBet(b: typeof betsTable.$inferSelect) {
  return {
    id: b.id,
    gameId: b.gameId,
    homeTeam: b.homeTeam,
    awayTeam: b.awayTeam,
    sport: b.sport,
    market: b.market,
    selection: b.selection,
    point: b.point != null ? parseFloat(b.point) : null,
    bookmaker: b.bookmaker,
    americanOdds: parseFloat(b.americanOdds),
    evPercent: parseFloat(b.evPercent),
    units: parseFloat(b.units),
    status: b.status,
    pnl: b.pnl != null ? parseFloat(b.pnl) : null,
    commenceTime: b.commenceTime,
    notes: b.notes ?? null,
    closingOdds: b.closingOdds ?? null,
    clvPercent: b.clvPercent != null ? parseFloat(b.clvPercent) : null,
    createdAt: b.createdAt.toISOString(),
  };
}

router.get("/bets", async (_req, res): Promise<void> => {
  const bets = await db.select().from(betsTable).orderBy(betsTable.createdAt);
  res.json(bets.map(formatBet));
});

router.post("/bets", async (req, res): Promise<void> => {
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const [bet] = await db
    .insert(betsTable)
    .values({
      gameId: d.gameId,
      homeTeam: d.homeTeam,
      awayTeam: d.awayTeam,
      sport: d.sport,
      market: d.market,
      selection: d.selection,
      point: d.point != null ? String(d.point) : null,
      bookmaker: d.bookmaker,
      americanOdds: String(d.americanOdds),
      evPercent: String(d.evPercent),
      units: String(d.units),
      status: "pending",
      commenceTime: d.commenceTime,
      notes: d.notes ?? null,
    })
    .returning();

  res.status(201).json(formatBet(bet));
});

router.patch("/bets/:id", async (req, res): Promise<void> => {
  const params = UpdateBetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (d.status !== undefined) updateData.status = d.status;
  if (d.notes !== undefined) updateData.notes = d.notes;
  if (d.pnl !== undefined) updateData.pnl = d.pnl != null ? String(d.pnl) : null;

  if (d.closingOdds != null) {
    updateData.closingOdds = d.closingOdds;
    const [existing] = await db.select().from(betsTable).where(eq(betsTable.id, params.data.id)).limit(1);
    if (existing) {
      const yourImplied = americanToImpliedProb(parseFloat(existing.americanOdds));
      const closingImplied = americanToImpliedProb(d.closingOdds);
      updateData.clvPercent = String(Math.round((closingImplied - yourImplied) * 10000) / 100);
    }
  }

  const [bet] = await db
    .update(betsTable)
    .set(updateData)
    .where(eq(betsTable.id, params.data.id))
    .returning();

  if (!bet) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }

  res.json(formatBet(bet));
});

router.delete("/bets/:id", async (req, res): Promise<void> => {
  const params = DeleteBetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bet] = await db
    .delete(betsTable)
    .where(eq(betsTable.id, params.data.id))
    .returning();

  if (!bet) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/bets/stats", async (_req, res): Promise<void> => {
  const bets = await db.select().from(betsTable);

  const settled = bets.filter((b) => b.status !== "pending");
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const pushes = settled.filter((b) => b.status === "push").length;
  const pending = bets.filter((b) => b.status === "pending").length;

  const totalUnitsWagered = bets.reduce((sum, b) => sum + parseFloat(b.units), 0);
  const settledUnitsWagered = settled.reduce((sum, b) => sum + parseFloat(b.units), 0);
  const totalPnl = settled.reduce((sum, b) => sum + (b.pnl != null ? parseFloat(b.pnl) : 0), 0);
  const roi = settledUnitsWagered > 0 ? (totalPnl / settledUnitsWagered) * 100 : 0;
  const winRate = settled.length > 0 ? wins / settled.length : 0;

  const sportMap = new Map<string, { bets: number; wins: number; pnl: number; wagered: number }>();
  for (const b of bets) {
    if (!sportMap.has(b.sport)) sportMap.set(b.sport, { bets: 0, wins: 0, pnl: 0, wagered: 0 });
    const s = sportMap.get(b.sport)!;
    s.bets++;
    if (b.status !== "pending") s.wagered += parseFloat(b.units);
    if (b.status === "won") s.wins++;
    if (b.pnl != null) s.pnl += parseFloat(b.pnl);
  }

  const bySport = Array.from(sportMap.entries()).map(([sport, s]) => ({
    sport,
    bets: s.bets,
    wins: s.wins,
    roi: s.wagered > 0 ? Math.round((s.pnl / s.wagered) * 10000) / 100 : 0,
  }));

  res.json({
    totalBets: bets.length,
    wins,
    losses,
    pushes,
    pending,
    roi: Math.round(roi * 100) / 100,
    totalUnitsWagered: Math.round(totalUnitsWagered * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    winRate: Math.round(winRate * 10000) / 100,
    bySport,
  });
});

export default router;
