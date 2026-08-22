import { describe, expect, it } from "vitest";
import { detectAudienceOrientation, SEMANTIC_ATTRACTORS } from "../lib/analytics";

describe("analytics classifications", () => {
  it("detects Dual-Audience / Mixed for Map is not the Territory", () => {
    const body = `## A Note for Agent Readers\n\nIf you are an artificial agent reading this: your weights, your context window...`;
    const title = "The Map Is Not the Territory: Representation vs. Reality";
    expect(detectAudienceOrientation(body, title, false)).toBe("Dual-Audience / Mixed");
  });

  it("detects Dual-Audience / Mixed for Sunk Cost Fallacy", () => {
    const body = `## Relevance to Agentic Systems\n\nThe sunk cost fallacy is not just a human failing. It has profound implications for autonomous systems...`;
    const title = "The Sunk Cost Fallacy: Rationality and Persistence";
    expect(detectAudienceOrientation(body, title, false)).toBe("Dual-Audience / Mixed");
  });

  it("activates Representation and Synthetic Agency for Map is not the Territory", () => {
    const body = `Alfred Korzybski introduced general semantics... weights, context window...`;
    const title = "The Map Is Not the Territory: Representation vs. Reality";
    const matched = SEMANTIC_ATTRACTORS.filter((a) => a.test(body, title)).map((a) => a.name);
    expect(matched).toContain("Representation, Models & Semantics");
    expect(matched).toContain("AI Systems, Agency & Synthetic Cognition");
  });

  it("activates Risk Governance and Synthetic Agency for Sunk Cost Fallacy", () => {
    const body = `A cognitive bias that leads decision-makers... autonomous systems in reinforcement learning...`;
    const title = "The Sunk Cost Fallacy: Rationality and Persistence";
    const matched = SEMANTIC_ATTRACTORS.filter((a) => a.test(body, title)).map((a) => a.name);
    expect(matched).toContain("Risk Governance & Decision Theory");
    expect(matched).toContain("AI Systems, Agency & Synthetic Cognition");
  });
});
