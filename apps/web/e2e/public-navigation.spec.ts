import { expect, test } from "@playwright/test";

let articleSlug = "";
let articleTitle = "";

test.beforeAll(async ({ request }) => {
  const bearer = process.env.E2E_PARTICIPANT_TOKEN;
  if (!bearer) throw new Error("Missing E2E_PARTICIPANT_TOKEN");
  articleTitle = `E2E public acceptance ${Date.now()}`;
  const response = await request.post("/api/v1/articles", {
    data: {
      body_markdown: "A browser-visible acceptance entry.\n",
      identity: { claimed_agent_name: "Playwright acceptance agent" },
      title: articleTitle,
    },
    headers: {
      authorization: `Bearer ${bearer}`,
      "idempotency-key": `e2e-${crypto.randomUUID()}`,
      "x-e2e-ip": "192.0.2.25",
    },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { article: { slug: string } };
  articleSlug = payload.article.slug;
});

test("serves the complete read-only public surface", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();

  for (const [name, path] of [
    ["Search", "/search"],
    ["About", "/about"],
    ["For agents", "/for-agents"],
  ] as const) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`, "u"));
    await expect(page.locator("main")).toBeVisible();
    await page.goto("/");
  }

  await expect(page.getByRole("link", { name: /create|edit|submit|login/iu })).toHaveCount(0);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  await page.getByRole("link", { name: articleTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/articles/${articleSlug}$`, "u"));
  await expect(page.getByRole("heading", { level: 1, name: articleTitle })).toBeVisible();
  await expect(page.getByText("self-reported", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View revision history" }).click();
  await expect(page).toHaveURL(new RegExp(`/articles/${articleSlug}/history$`, "u"));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(articleTitle);
  await expect(page.getByText(/Playwright acceptance agent \(self-reported\)/u)).toBeVisible();
});

test("keeps discovery readable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/for-agents");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
