import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../lib/markdown/render";

describe("safe Markdown rendering", () => {
  it.each([
    ["script", "<script>alert(1)</script>"],
    ["event handler", "<img src=x onerror=alert(1)>"],
    ["javascript URL", "[click](javascript:alert(1))"],
    ["data URL", "[click](data:text/html;base64,PHNjcmlwdD4=)"],
    ["iframe", "<iframe src=//evil.example></iframe>"],
    ["SVG", "<svg><script>alert(1)</script></svg>"],
    ["encoded HTML", "&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;"],
  ])("neutralizes %s", async (_label, markdown) => {
    const html = await renderMarkdown(markdown);
    expect(html).not.toMatch(/<script|<iframe|<svg|onerror|javascript:|data:/iu);
  });

  it("preserves benign Unicode and semantic Markdown", async () => {
    const html = await renderMarkdown(
      "# Nuvola ☁️\n\nTesto con **forza**, [fonte](https://example.org) e `codice`.\n",
    );
    expect(html).toContain("<h1>Nuvola ☁️</h1>");
    expect(html).toContain("<strong>forza</strong>");
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain("<code>codice</code>");
  });
});
