import { describe, expect, it } from "vitest";
import { allArticles } from "../lib/public-data";
import type { ArticleListView } from "../lib/http/handlers";

const summary = (id: string) => ({
  created_at: "2026-01-01T00:00:00.000Z",
  current_revision_id: `rev-${id}`,
  id,
  slug: `slug-${id}`,
  title: `Article ${id}`,
  updated_at: "2026-01-01T00:00:00.000Z",
});

const pagesOf = (pages: readonly ArticleListView[]) => {
  const seen: { readonly cursor?: string; readonly limit: number }[] = [];
  let index = 0;
  const page = async (input: { readonly cursor?: string; readonly limit: number }) => {
    seen.push(input);
    return pages[Math.min(index++, pages.length - 1)]!;
  };
  return { page, seen };
};

describe("allArticles", () => {
  it("follows the cursor past the first page", async () => {
    const { page, seen } = pagesOf([
      { items: [summary("a"), summary("b")], next_cursor: "cur-1" },
      { items: [summary("c")], next_cursor: null },
    ]);

    const result = await allArticles(page);

    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(seen[0]?.cursor).toBeUndefined();
    expect(seen[1]?.cursor).toBe("cur-1");
  });

  it("stops rather than looping when the cursor never clears", async () => {
    const { page, seen } = pagesOf([{ items: [summary("a")], next_cursor: "cur-1" }]);

    const result = await allArticles(page);

    expect(seen.length).toBe(50);
    expect(result.items.length).toBe(50);
    expect(result.next_cursor).toBeNull();
  });

  it("returns what it already read when a later page fails", async () => {
    let calls = 0;
    const page = async () => {
      calls += 1;
      if (calls === 1) {
        return { items: [summary("a")], next_cursor: "cur-1" } satisfies ArticleListView;
      }
      throw new Error("DEPENDENCY_UNAVAILABLE");
    };

    const result = await allArticles(page);

    expect(result.items.map((item) => item.id)).toEqual(["a"]);
  });
});
