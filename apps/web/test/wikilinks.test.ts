import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../lib/markdown/render";
import {
  computeWantedArticles,
  extractWikilinks,
  normalizeWikiKey,
  resolveWikilinksToMarkdown,
} from "../lib/markdown/wikilinks";

describe("wikilinks processing", () => {
  it("normalizes wiki keys properly", () => {
    expect(normalizeWikiKey("The Map Is Not The Territory")).toBe("the map is not the territory");
    expect(normalizeWikiKey("Sunk-Cost Fallacy: Rationality & Risk")).toBe("sunk-cost fallacy rationality risk");
    expect(normalizeWikiKey("  “Umwelt”  ")).toBe("umwelt");
  });

  it("extracts wikilinks without and with aliases", () => {
    const markdown = `
      Check [[The Map Is Not the Territory]] and [[The Sunk Cost Fallacy|sunk cost fallacy]].
      Also see [[Bounded Rationality]].
    `;
    const links = extractWikilinks(markdown);
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({
      raw: "[[The Map Is Not the Territory]]",
      target: "The Map Is Not the Territory",
      label: "The Map Is Not the Territory",
    });
    expect(links[1]).toEqual({
      raw: "[[The Sunk Cost Fallacy|sunk cost fallacy]]",
      target: "The Sunk Cost Fallacy",
      label: "sunk cost fallacy",
    });
    expect(links[2]).toEqual({
      raw: "[[Bounded Rationality]]",
      target: "Bounded Rationality",
      label: "Bounded Rationality",
    });
  });

  it("resolves existing articles to markdown links and missing articles to wanted links", () => {
    const knownArticles = [
      {
        slug: "the-map-is-not-the-territory-5829826a",
        title: "The Map Is Not the Territory",
      },
    ];

    const source = "See [[The Map Is Not the Territory|representation]] and [[Non-Existent Concept]].";
    const resolved = resolveWikilinksToMarkdown(source, knownArticles);

    expect(resolved).toContain('[representation](/articles/the-map-is-not-the-territory-5829826a "Wikilink: The Map Is Not the Territory")');
    expect(resolved).toContain('[Non-Existent Concept](/wanted?target=Non-Existent%20Concept');
  });

  it("renders resolved wikilinks and wanted wikilinks into clean sanitized HTML", async () => {
    const knownArticles = [
      {
        slug: "the-map-is-not-the-territory-5829826a",
        title: "The Map Is Not the Territory",
      },
    ];

    const source = "Link to [[The Map Is Not the Territory]] and wanted [[Cybernetic Feedback]].";
    const html = await renderMarkdown(source, knownArticles);

    expect(html).toContain('href="/articles/the-map-is-not-the-territory-5829826a"');
    expect(html).toContain('href="/wanted?target=Cybernetic%20Feedback"');
    expect(html).toContain('title="Wanted entry: &#x27;Cybernetic Feedback&#x27; has not been authored yet"');
  });

  it("computes wanted articles across multiple corpus entries", () => {
    const articles = [
      {
        id: "art-1",
        slug: "art-1",
        title: "Article One",
        body_markdown: "Mentions [[Wanted Topic A]] and [[Wanted Topic B|topic b]].",
      },
      {
        id: "art-2",
        slug: "art-2",
        title: "Article Two",
        body_markdown: "Also mentions [[Wanted Topic A]] and [[Article One]].",
      },
    ];

    const wanted = computeWantedArticles(articles);
    expect(wanted).toHaveLength(2);
    expect(wanted[0]?.targetTitle).toBe("Wanted Topic A");
    expect(wanted[0]?.incomingCount).toBe(2);
    expect(wanted[1]?.targetTitle).toBe("Wanted Topic B");
    expect(wanted[1]?.incomingCount).toBe(1);
  });
});
