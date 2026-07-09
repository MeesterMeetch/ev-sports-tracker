import { describe, it, expect } from "vitest";
import { formatSportKey } from "./index";

describe("formatSportKey", () => {
  it("returns the short label for a known sport key", () => {
    expect(formatSportKey("basketball_nba")).toBe("NBA");
    expect(formatSportKey("americanfootball_nfl")).toBe("NFL");
    expect(formatSportKey("icehockey_nhl")).toBe("NHL");
  });

  it("extracts and uppercases the last segment of an unknown key", () => {
    expect(formatSportKey("basketball_wnba_development")).toBe("DEVELOPMENT");
    expect(formatSportKey("soccer_epl")).toBe("EPL");
    expect(formatSportKey("rugby_union_super")).toBe("SUPER");
  });

  it("returns the full key uppercased when there is no underscore", () => {
    expect(formatSportKey("nfl")).toBe("NFL");
    expect(formatSportKey("unknown")).toBe("UNKNOWN");
  });
});
