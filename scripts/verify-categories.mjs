import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts =
  process.env.FINANCE_CATEGORIES_ARTIFACT_DIR ??
  join(root, ".cloudflare/categories-verification");
await mkdir(artifacts, { recursive: true });
const fixture = spawn(
  process.execPath,
  [join(root, "scripts/verify-access.mjs"), "--serve"],
  {
    cwd: root,
    env: process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "",
  base,
  browser;
fixture.stdout.on("data", (value) => {
  logs = (logs + value).slice(-60000);
});
fixture.stderr.on("data", (value) => {
  logs = (logs + value).slice(-60000);
});
const checks = [],
  pageErrors = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function cookie(user) {
  const response = await fetch(base + "/_verification/sign-in/" + user, {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  return response.headers.get("set-cookie").split(";")[0];
}
async function api(
  path,
  identity,
  { method = "GET", body, status = 200 } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Cookie: identity,
      ...(method !== "GET" ? { Origin: base } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const value = response.status === 204 ? undefined : await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(value)}`,
  );
  if (path.startsWith("/api/"))
    assert.equal(response.headers.get("cache-control"), "no-store");
  return value;
}
async function axe(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    label,
  );
}
async function screenshot(page, name) {
  await page.screenshot({
    path: join(artifacts, name + ".png"),
    fullPage: true,
  });
}
async function executable() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  for (const path of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ])
    try {
      await access(path);
      return path;
    } catch {}
  return undefined;
}
function signal(name) {
  if (fixture.exitCode === null && fixture.signalCode === null)
    try {
      process.kill(
        process.platform === "win32" ? fixture.pid : -fixture.pid,
        name,
      );
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
}
async function stop() {
  if (browser) await browser.close();
  if (fixture.exitCode !== null || fixture.signalCode !== null) return;
  const done = new Promise((resolve) => fixture.once("close", resolve));
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), 5000);
  await done;
  clearTimeout(timer);
}
async function run() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const match = logs.match(
      /Browser verification fixture ready: (http:\/\/127\.0\.0\.1:\d+)\//,
    );
    if (match) {
      base = match[1];
      break;
    }
    if (fixture.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(base, "Signed Worker/D1 fixture startup failed: " + logs);
  const owner = await cookie("owner"),
    member = await cookie("member"),
    stranger = await cookie("newcomer");
  const h = (await api("/api/v1/session", owner)).households[0];
  const other = await api("/api/v1/households", stranger, {
    method: "POST",
    body: { name: "Unrelated category household" },
    status: 201,
  });
  const invite = await api(`/api/v1/households/${h.id}/invitations`, owner, {
    method: "POST",
    body: { email: "member@example.invalid" },
    status: 201,
  });
  const joined = await api("/api/v1/invitations/accept", member, {
    method: "POST",
    body: { token: invite.token },
    status: 201,
  });
  const path = `/api/v1/households/${h.id}/categories`;
  let expense, income, foreign, archived;
  await check(
    "empty categories and optional reference names do not seed records",
    async () => {
      assert.deepEqual((await api(path, owner)).categories, []);
      const reference = await api(path + "/reference-names", member);
      assert.ok(reference.expense.includes("Groceries"));
      assert.ok(reference.income.includes("Salary"));
      assert.deepEqual((await api(path, owner)).categories, []);
      assert.equal(
        (await api(`/api/v1/households/${h.id}/workspace`, owner)).counts
          .transactions,
        0,
      );
    },
  );
  await check(
    "both members manage categories; invalid input and cross-household IDs are rejected",
    async () => {
      expense = await api(path, owner, {
        method: "POST",
        body: { name: " Food ' Ž ", type: "expense" },
        status: 201,
      });
      income = await api(path, member, {
        method: "POST",
        body: { name: "Salary", type: "income" },
        status: 201,
      });
      foreign = await api(
        `/api/v1/households/${other.id}/categories`,
        stranger,
        {
          method: "POST",
          body: { name: "Private", type: "expense" },
          status: 201,
        },
      );
      assert.equal(expense.name, "Food ' Ž");
      assert.equal(expense.status, "active");
      assert.equal((await api(path + "/" + expense.id, member)).id, expense.id);
      for (const body of [
        { name: " ", type: "expense" },
        { name: "x".repeat(81), type: "expense" },
        { name: "x", type: "fee" },
        { name: "x", type: "income", status: "active" },
        null,
        [],
      ])
        await api(path, owner, { method: "POST", body, status: 400 });
      for (const body of [
        {},
        { type: "income" },
        { status: null },
        { name: null },
        { status: "deleted" },
      ])
        await api(path + "/" + expense.id, owner, {
          method: "PATCH",
          body,
          status: 400,
        });
      await api(path + "?status=bad", owner, { status: 400 });
      await api(path + "/" + foreign.id, owner, { status: 404 });
      await api(path + "/" + foreign.id, owner, {
        method: "PATCH",
        body: { name: "Rejected" },
        status: 404,
      });
      await api(path, stranger, { status: 404 });
      await api(path, stranger, {
        method: "POST",
        body: { name: "Rejected", type: "expense" },
        status: 404,
      });
      await api(path + "/reference-names", stranger, { status: 404 });
      await api(path + "/" + randomUUID(), owner, { status: 404 });
    },
  );
  await check(
    "selection lists offer only active categories eligible for each purpose",
    async () => {
      archived = await api(path, owner, {
        method: "POST",
        body: { name: "Archived reference", type: "expense" },
        status: 201,
      });
      await api(path + "/" + archived.id, member, {
        method: "PATCH",
        body: { status: "archived" },
      });
      for (const usage of [
        "expense",
        "fee",
        "refund",
        "budget",
        "income",
        "transfer",
      ]) {
        const result = await api(path + "/options?usage=" + usage, member);
        assert.equal(result.usage, usage);
        assert.deepEqual(
          result.categories.map((c) => c.id),
          usage === "transfer"
            ? []
            : [usage === "income" ? income.id : expense.id],
        );
      }
      assert.deepEqual(
        (await api(path + "?status=archived", owner)).categories.map(
          (c) => c.id,
        ),
        [archived.id],
      );
      assert.equal(
        (await api(path + "?status=active", owner)).categories.length,
        2,
      );
      await api(path + "/options", owner, { status: 400 });
      await api(path + "/options?usage=other", owner, { status: 400 });
      await api(path + "/options?usage=expense&status=all", owner, {
        status: 400,
      });
    },
  );
  async function assertion(categoryId, usage, status = 200) {
    const marker = randomUUID();
    const result = await api("/_verification/category-assert", member, {
      method: "POST",
      body: { householdId: h.id, categoryId, usage, marker },
      status,
    });
    if (status !== 200) {
      assert.equal(result.error.code, "CATEGORY_NOT_ELIGIBLE");
      assert.deepEqual(
        await api(
          "/_verification/category-assert?" +
            new URLSearchParams({ householdId: h.id, marker }),
          member,
        ),
        [],
      );
    }
  }
  await check(
    "atomic eligibility assertions reject stale/wrong choices and roll back prior writes",
    async () => {
      for (const usage of ["expense", "fee", "refund", "budget", "income"]) {
        await assertion(usage === "income" ? income.id : expense.id, usage);
        await assertion(
          usage === "income" ? expense.id : income.id,
          usage,
          409,
        );
      }
      await assertion(null, "transfer");
      await assertion(expense.id, "transfer", 409);
      await assertion(null, "expense", 409);
      await assertion(foreign.id, "expense", 409);
      await assertion(archived.id, "expense", 409);
      await assertion(expense.id, "invalid", 409);
      await api(path + "/" + expense.id, owner, {
        method: "PATCH",
        body: { status: "archived" },
      });
      await assertion(expense.id, "expense", 409);
      await api(path + "/" + expense.id, owner, {
        method: "PATCH",
        body: { status: "active" },
      });
    },
  );
  await check(
    "renaming and archival retain readable history; type stays immutable",
    async () => {
      const history = "/_verification/category-history";
      await api(history, owner, {
        method: "POST",
        body: { householdId: h.id, categoryId: expense.id },
      });
      await api(path + "/" + expense.id, member, {
        method: "PATCH",
        body: { name: "Food history", status: "archived" },
      });
      const saved = await api(path + "/" + expense.id, owner);
      assert.equal(saved.type, "expense");
      assert.equal(saved.status, "archived");
      assert.equal(saved.name, "Food history");
      const rows = await api(
        history +
          "?" +
          new URLSearchParams({ householdId: h.id, categoryId: expense.id }),
        owner,
      );
      assert.equal(rows[0].transactionCount, 1);
      assert.equal(rows[0].planCount, 1);
      assert.equal(rows[0].id, expense.id);
      for (const category of [expense, income]) {
        const result = await api(history, owner, {
          method: "PATCH",
          body: {
            householdId: h.id,
            categoryId: category.id,
            type: category.type === "income" ? "expense" : "income",
          },
          status: 409,
        });
        assert.equal(result.error.code, "CATEGORY_TYPE_IMMUTABLE");
        assert.equal(
          (await api(path + "/" + category.id, owner)).type,
          category.type,
        );
      }
      await api(path + "/" + expense.id, owner, {
        method: "DELETE",
        status: 404,
      });
      assert.equal((await api(path + "/" + expense.id, owner)).id, expense.id);
      assert.ok(
        !(await api(path + "/options?usage=budget", owner)).categories.some(
          (c) => c.id === expense.id,
        ),
      );
      await api(path + "/" + expense.id, owner, {
        method: "PATCH",
        body: { status: "active" },
      });
      assert.ok(
        (await api(path + "/options?usage=refund", owner)).categories.some(
          (c) => c.id === expense.id,
        ),
      );
    },
  );
  await check(
    "concurrent independent edits merge and revocation blocks subsequent category operations",
    async () => {
      const category = await api(path, owner, {
        method: "POST",
        body: { name: "Concurrent", type: "expense" },
        status: 201,
      });
      await Promise.all([
        api(path + "/" + category.id, member, {
          method: "PATCH",
          body: { name: "Concurrent renamed" },
        }),
        api(path + "/" + category.id, owner, {
          method: "PATCH",
          body: { status: "archived" },
        }),
      ]);
      const saved = await api(path + "/" + category.id, owner);
      assert.equal(saved.name, "Concurrent renamed");
      assert.equal(saved.status, "archived");
      await api(
        `/api/v1/households/${h.id}/members/${joined.memberId}`,
        owner,
        { method: "DELETE", status: 204 },
      );
      for (const suffix of [
        "",
        "/options?usage=expense",
        "/reference-names",
        "/" + expense.id,
      ])
        await api(path + suffix, member, { status: 404 });
      await api(path, member, {
        method: "POST",
        body: { name: "Rejected", type: "income" },
        status: 404,
      });
      await api(path + "/" + expense.id, member, {
        method: "PATCH",
        body: { status: "archived" },
        status: 404,
      });
    },
  );
  if (process.argv.includes("--api-only")) return;
  browser = await chromium.launch({
    executablePath: await executable(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await check(
    "category browser flow creates, renames, archives, restores and resets real filters",
    async () => {
      await page.goto(base + "/_verification/sign-in/owner");
      await page.locator("summary").click();
      await page
        .locator(".profile-links")
        .getByRole("link", { name: "Categories", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Categories", level: 1, exact: true })
        .waitFor();
      await page
        .getByText("Loading categories…", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await page.title(), "Categories | Family Finance");
      const before = (await api(path, owner)).categories.length;
      await page
        .getByRole("button", { name: "Groceries", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Name", { exact: true }).inputValue(),
        "Groceries",
      );
      assert.equal((await api(path, owner)).categories.length, before);
      await page.getByLabel("Name", { exact: true }).fill("Browser category");
      await page.getByLabel("Name", { exact: true }).press("Enter");
      await page
        .getByRole("button", { name: "Rename Browser category", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Rename Browser category", exact: true })
        .click();
      await page
        .getByLabel("Category name", { exact: true })
        .fill("Browser renamed");
      await page.getByLabel("Category name", { exact: true }).press("Enter");
      await page
        .getByRole("button", { name: "Archive Browser renamed", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Restore Browser renamed", exact: true })
        .waitFor();
      await page
        .getByLabel("Search categories", { exact: true })
        .fill("no such category match");
      await page
        .getByRole("button", { name: "Reset filters", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("button", { name: "Restore Browser renamed", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Archive Browser renamed", exact: true })
        .waitFor();
      await page.getByLabel("Status", { exact: true }).selectOption("active");
      assert.equal(
        await page
          .getByRole("button", {
            name: "Restore Archived reference",
            exact: true,
          })
          .count(),
        0,
      );
      for (const [name, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
        ["narrow", 320, 740],
      ]) {
        await page.setViewportSize({ width, height });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          name + " overflow",
        );
        const search = await page
          .getByLabel("Search categories", { exact: true })
          .boundingBox();
        const status = await page
          .getByLabel("Status", { exact: true })
          .boundingBox();
        assert.ok(search && status);
        const overlapX =
          Math.min(search.x + search.width, status.x + status.width) -
          Math.max(search.x, status.x);
        const overlapY =
          Math.min(search.y + search.height, status.y + status.height) -
          Math.max(search.y, status.y);
        assert.ok(
          overlapX <= 0.5 || overlapY <= 0.5,
          name + " category filter controls overlap",
        );
        await axe(page, name + " categories");
        await screenshot(page, name + "-categories");
      }
      await page.reload();
      await page
        .getByRole("button", { name: "Archive Browser renamed", exact: true })
        .waitFor();
    },
  );
  await check(
    "category loading, failure and retry do not masquerade as empty results",
    async () => {
      const listPattern = /\/api\/v1\/households\/[^/]+\/categories(?:\?.*)?$/;
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route(listPattern, async (route) => {
        await held;
        await route.continue();
      });
      const reloading = page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Loading categories…", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByText("No categories yet. Create one to get started.", {
            exact: true,
          })
          .count(),
        0,
      );
      release();
      await reloading;
      await page
        .getByRole("button", { name: "Archive Browser renamed", exact: true })
        .waitFor();
      await page.unroute(listPattern);
      let fail = true;
      await page.route(listPattern, async (route) => {
        if (route.request().method() === "GET" && fail)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "DATABASE_UNAVAILABLE",
                message: "Category service unavailable",
              },
            }),
          });
        else await route.continue();
      });
      await page.reload();
      await page
        .getByRole("alert")
        .filter({ hasText: "Category service unavailable" })
        .waitFor();
      assert.equal(
        await page
          .getByText("No categories yet. Create one to get started.", {
            exact: true,
          })
          .count(),
        0,
      );
      fail = false;
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Archive Browser renamed", exact: true })
        .waitFor();
      await page.unroute(listPattern);
    },
  );
  assert.deepEqual(pageErrors, [], "browser page errors");
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(
      {
        checks,
        pageErrors,
        axe: "Zero WCAG A/AA violations at 1440, 390 and 320px",
        fixture: "Actual local Worker/D1, signed synthetic identities",
      },
      null,
      2,
    ),
  );
}
for (const [name, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
])
  process.once(name, () => {
    void stop().finally(() => process.exit(code));
  });
try {
  await run();
  console.log(
    `Category verification passed (${checks.length} groups). Artifacts: ${artifacts}`,
  );
} catch (error) {
  console.error(error.stack ?? error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  await stop();
}
