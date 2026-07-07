import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const emailSignals = pgTable("email_signals", {
  id: serial("id").primaryKey(),
  gmailId: text("gmail_id").notNull().unique(),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  subject: text("subject").notNull().default("(no subject)"),
  date: timestamp("date").notNull(),
  bodySnippet: text("body_snippet").notNull().default(""),
  signalScore: integer("signal_score").notNull().default(0),
  category: text("category").notNull().default("noise"),
  summary: text("summary").notNull().default(""),
  topics: text("topics").array().notNull().default([]),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export const actionItems = pgTable("action_items", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").notNull(),
  text: text("text").notNull(),
  deadline: text("deadline"),
  priority: text("priority").notNull().default("medium"),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailEntities = pgTable("email_entities", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailSignal = typeof emailSignals.$inferSelect;
export type ActionItem = typeof actionItems.$inferSelect;
export type EmailEntity = typeof emailEntities.$inferSelect;
