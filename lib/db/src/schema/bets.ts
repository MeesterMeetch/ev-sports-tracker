import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  gameId: text("game_id").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  sport: text("sport").notNull(),
  market: text("market").notNull(),
  selection: text("selection").notNull(),
  point: numeric("point"),
  bookmaker: text("bookmaker").notNull(),
  americanOdds: numeric("american_odds").notNull(),
  evPercent: numeric("ev_percent").notNull(),
  units: numeric("units").notNull(),
  status: text("status").notNull().default("pending"),
  pnl: numeric("pnl"),
  commenceTime: text("commence_time").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBetSchema = createInsertSchema(betsTable).omit({ id: true, createdAt: true });
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;
