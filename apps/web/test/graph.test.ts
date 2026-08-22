import { describe, expect, it } from "vitest";

import { calculateSemanticAffinity } from "../lib/graph";

describe("graph analytics & affinity", () => {
  it("calculates semantic affinity based on shared attractors and keyword overlap", () => {
    const docA = {
      title: "The Map Is Not the Territory",
      text: "Alfred Korzybski mental models abstraction representation reality",
      attractors: ["Representation, Models & Semantics", "AI Systems, Agency & Synthetic Cognition"],
    };

    const docB = {
      title: "Mental Models and Representation",
      text: "Models abstraction semantics representation reality mapping",
      attractors: ["Representation, Models & Semantics"],
    };

    const docC = {
      title: "Public Libraries and Civic Care",
      text: "Books preservation physical maintenance community archive",
      attractors: ["Civic Commons & Memory Institutions", "Material Care, Maintenance & Technics"],
    };

    const affinityAB = calculateSemanticAffinity(docA, docB);
    const affinityAC = calculateSemanticAffinity(docA, docC);

    expect(affinityAB).toBeGreaterThan(0.4);
    expect(affinityAC).toBeLessThan(0.2);
  });
});
