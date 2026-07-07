import { Router } from "express";
import type { IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AnalyzeGameBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SPORT_MODULE_HINTS: Record<string, string> = {
  baseball_mlb: "Apply MLB module rules: confirm starting pitchers, check F5 lines, consider weather (wind direction/speed), bullpen usage last 3 days, wRC+ vs handedness.",
  americanfootball_nfl: "Apply NFL module: focus on player props with role changes, key numbers (3 and 7), injury reports with timestamps, EPA/play metrics.",
  americanfootball_ncaaf: "Apply NCAAF module: check Group of 5 and FCS lines, talent gap via recruiting composites, coaching ATS in motivation spots.",
  basketball_nba: "Apply NBA module: late-scratch discipline (check 30min before tip), net ratings, rest differential (B2B = ~2pts), player props where rotation changed.",
  basketball_ncaab: "Apply NCAAM module: use KenPom/Torvik baseline, home-court variance, conference tourney implications.",
  icehockey_nhl: "Apply NHL module: confirmed starting goalies required, GSAx last 10 starts, 5v5 xGF%, PDO regression candidates, puck line vs ML pricing.",
  tennis_atp: "Apply Tennis module: surface-specific Elo only, serve/return hold% on THIS surface last 52 weeks, fatigue (matches in last 7 days), retirement risk.",
  golf_pga_championship: "Apply Golf module: strokes gained by category, course fit, AM/PM draw wind split, eighth-Kelly for outrights, dead-heat rule on placements.",
};

router.post("/analysis/game", async (req, res): Promise<void> => {
  const parsed = AnalyzeGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { gameId, homeTeam, awayTeam, sport, market, additionalContext } = parsed.data;
  const sportHint = SPORT_MODULE_HINTS[sport] ?? "Apply standard EV analysis with sharp line de-vig.";

  const prompt = `You are a rigorous sports betting analyst using the v4-O EV framework.

Game: ${awayTeam} @ ${homeTeam}
Sport: ${sport}
${market ? `Market focus: ${market}` : ""}
${additionalContext ? `Additional context: ${additionalContext}` : ""}

Sport-specific module: ${sportHint}

Analyze this game for betting value. Follow this structure:
1. Key factors driving the line
2. Any edges (statistical, situational, news-based) 
3. Markets worth targeting and why
4. Risk factors / what would change your view
5. Final recommendation: PASS or specific bet with confidence (1-5 stars)

Be concise and precise. Use numbers. Do not hedge everything. If there is no edge, say so clearly.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const analysisText = completion.choices[0]?.message?.content ?? "No analysis available.";

    const recMatch = analysisText.match(/(?:recommendation|recommend)[:\s]+([^\n.]+)/i);
    const recommendation = recMatch ? recMatch[1].trim() : "See analysis";

    const starsMatch = analysisText.match(/(\d)\s*(?:star|\/5|\*)/i);
    const confidence = starsMatch ? Math.min(5, Math.max(1, parseInt(starsMatch[1], 10))) : 3;

    const keyFactors: string[] = [];
    const risks: string[] = [];

    const lines = analysisText.split("\n");
    let inFactors = false;
    let inRisks = false;
    for (const line of lines) {
      const clean = line.replace(/^[-*•\d.]+\s*/, "").trim();
      if (!clean) continue;
      if (/key factor/i.test(line)) { inFactors = true; inRisks = false; continue; }
      if (/risk/i.test(line)) { inRisks = true; inFactors = false; continue; }
      if (/market|recommendation|final/i.test(line)) { inFactors = false; inRisks = false; continue; }
      if (inFactors && clean.length > 10 && keyFactors.length < 4) keyFactors.push(clean);
      if (inRisks && clean.length > 10 && risks.length < 3) risks.push(clean);
    }

    res.json({
      gameId,
      analysis: analysisText,
      recommendation,
      confidence,
      keyFactors,
      risks,
    });
  } catch (err) {
    req.log.error({ err }, "AI analysis failed");
    res.status(500).json({ error: "AI analysis failed" });
  }
});

export default router;
