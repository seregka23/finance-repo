import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".cloudflare/accounts-verification");
await mkdir(artifacts, { recursive: true });
const fixture = spawn(
  process.execPath,
  ["scripts/verify-access.mjs", "--serve"],
  {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "",
  browser;
for (const stream of [fixture.stdout, fixture.stderr])
  stream.on("data", (d) => {
    logs = (logs + d).slice(-60000);
  });
const errors = [],
  checks = [];
const password = "Browser-test-password-2026!";
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function axe(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
}
try {
  const deadline = Date.now() + 180000;
  let base;
  while (Date.now() < deadline) {
    base = logs.match(
      /Browser verification fixture ready: (http:\/\/127\.0\.0\.1:\d+)\//,
    )?.[1];
    if (base) break;
    if (fixture.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(base, logs);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  for (const [size, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width, height },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/_verification/sign-in/owner");
    await page.locator(".profile-menu").waitFor();
    const cookies = await context.cookies();
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await fetch(base + "/api/v1/households", {
      method: "POST",
      headers: {
        Origin: base,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Accounts " + size }),
    });
    assert.equal(response.status, 201);
    const household = await response.json();
    await page.reload();
    await page
      .getByLabel("Household", { exact: true })
      .selectOption(household.id);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Accounts", exact: true })
      .click();
    let accountId;
    const opener = page.locator(".pagehead").getByRole("button", {
      name: "Add account",
      exact: true,
    });
    const dialog = page.getByRole("dialog");
    const form = dialog
      .locator("form")
      .filter({ has: page.getByLabel("Opening balance", { exact: true }) });
    await check(
      `${size}: first-use creation fields and accessible layout`,
      async () => {
        await page
          .getByText(
            "No accounts yet. Add your first account to get started.",
            { exact: true },
          )
          .waitFor();
        assert.equal(await dialog.isVisible(), false);
        await opener.focus();
        await page.keyboard.press("Enter");
        await dialog.waitFor();
        assert.ok(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        );
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        assert.ok(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        );
        await form
          .getByLabel("Name", { exact: true })
          .fill("Discard this draft");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.ok(await opener.evaluate((el) => el === document.activeElement));
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Dashboard", exact: true })
          .click();
        await page
          .getByRole("link", { name: "Add account", exact: true })
          .click();
        await dialog.waitFor();
        assert.equal(new URL(page.url()).pathname, "/accounts");
        assert.notEqual(
          await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
          "rgba(0, 0, 0, 0)",
        );
        assert.equal(
          await form.getByLabel("Name", { exact: true }).inputValue(),
          "",
        );
        await form.getByLabel("Name", { exact: true }).fill("Browser cash");
        await form.getByLabel("Type").selectOption("cash");
        await form
          .getByLabel("Opening balance", { exact: true })
          .fill("123.45");
        await form.getByLabel("As of date", { exact: true }).fill("2026-01-01");
        await axe(page);
        await page.screenshot({
          path: join(artifacts, size + "-first-account.png"),
          fullPage: true,
        });
        const saved = page.waitForResponse(
          (r) =>
            r.url().endsWith("/accounts") && r.request().method() === "POST",
        );
        await form
          .getByRole("button", { name: "Create account", exact: true })
          .click();
        const created = await saved;
        assert.equal(created.status(), 201);
        await dialog.waitFor({ state: "hidden" });
        accountId = (await created.json()).id;
        await page
          .getByRole("button", { name: "View Browser cash", exact: true })
          .waitFor();
        await page
          .getByText("Jan 1, 2026 · opening_balance", { exact: true })
          .waitFor();
        assert.ok(
          (await page.locator(".accountrow").textContent()).includes(
            "123.45 RSD",
          ),
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      },
    );
    await check(
      `${size}: reviewed signed adjustments, editing, archiving and history`,
      async () => {
        const change = page.locator("form").filter({
          has: page.getByLabel("Signed change (RSD)", { exact: true }),
        });
        await change
          .getByLabel("Signed change (RSD)", { exact: true })
          .fill("-10.05");
        await change.getByLabel("Date", { exact: true }).fill("2026-02-01");
        await change
          .getByRole("button", { name: "Review change", exact: true })
          .click();
        await page.getByText(/Review: change Browser cash by -10.05/).waitFor();
        const adjusted = page.waitForResponse(
          (r) =>
            r.url().endsWith("/adjustments") && r.request().method() === "POST",
        );
        await change
          .getByRole("button", { name: "Confirm balance change", exact: true })
          .click();
        assert.equal((await adjusted).status(), 201);
        await page
          .getByText("Feb 1, 2026 · adjustment", { exact: true })
          .waitFor();
        assert.ok(
          (await page.locator(".accountrow").textContent()).includes(
            "113.40 RSD",
          ),
        );
        await page
          .getByRole("button", { name: "Edit account", exact: true })
          .click();
        const edit = page.locator("form").filter({
          has: page.getByRole("button", {
            name: "Save changes",
            exact: true,
          }),
        });
        await edit.getByLabel("Name", { exact: true }).fill("Renamed cash");
        const updated = page.waitForResponse(
          (r) =>
            r.request().method() === "PATCH" && r.url().includes("/accounts/"),
        );
        await edit
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        assert.equal((await updated).status(), 200);
        await page
          .getByRole("button", { name: "View Renamed cash", exact: true })
          .waitFor();
        const localApi = async (path, body) => {
          const response = await fetch(base + path, {
            method: "POST",
            headers: {
              Origin: base,
              Cookie: cookie,
              "Content-Type": "application/json",
              "Idempotency-Key": "browser-lock-" + size,
            },
            body: JSON.stringify(body),
          });
          assert.equal(response.status, 201, await response.clone().text());
          return response.json();
        };
        const category = await localApi(
          `/api/v1/households/${household.id}/categories`,
          { name: "Browser expense", type: "expense" },
        );
        await localApi(`/api/v1/households/${household.id}/transactions`, {
          type: "expense",
          transactionDate: "2026-02-02",
          accountId,
          categoryId: category.id,
          amountMinor: "1",
          currency: "RSD",
          exchangeRate: null,
          exchangeRateSource: null,
          merchant: null,
          note: null,
        });
        await page
          .getByRole("button", { name: "View Renamed cash", exact: true })
          .click();
        await page
          .getByText("Feb 2, 2026 · transaction", { exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Edit account", exact: true })
          .click();
        assert.equal(
          await page.locator('select[formcontrolname="currency"]').isDisabled(),
          true,
        );
        await page
          .getByRole("button", { name: "Cancel edit", exact: true })
          .click();
        const archived = page.waitForResponse((r) =>
          r.url().endsWith("/archive"),
        );
        await page
          .getByRole("button", { name: "Archive account", exact: true })
          .click();
        assert.equal((await archived).status(), 200);
        await page
          .getByRole("button", { name: "Restore account", exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Edit account", exact: true })
            .isDisabled(),
          true,
        );
        await page.getByLabel("Status").selectOption("active");
        await page
          .getByText("No accounts match this status.", { exact: true })
          .waitFor();
        await page.getByLabel("Status").selectOption("archived");
        await page
          .getByRole("button", { name: "View Renamed cash", exact: true })
          .waitFor();
        await page
          .getByText("Jan 1, 2026 · opening_balance", { exact: true })
          .waitFor();
        await axe(page);
        await page.screenshot({
          path: join(artifacts, size + "-archived.png"),
          fullPage: true,
        });
        const restored = page.waitForResponse((r) =>
          r.url().endsWith("/restore"),
        );
        await page
          .getByRole("button", { name: "Restore account", exact: true })
          .click();
        assert.equal((await restored).status(), 200);
        await page.getByLabel("Status").selectOption("all");
        await page.reload();
        await page
          .getByLabel("Household", { exact: true })
          .selectOption(household.id);
        await page
          .getByRole("button", { name: "View Renamed cash", exact: true })
          .click();
        await page
          .getByText("Feb 1, 2026 · adjustment", { exact: true })
          .waitFor();
        await axe(page);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      },
    );
    await check(`${size}: large amounts and 320px reflow`, async () => {
      await page.setViewportSize({ width: 320, height: 844 });
      await page
        .getByRole("button", { name: "Close details", exact: true })
        .click();
      await opener.click();
      await dialog.waitFor();
      const f = dialog
        .locator("form")
        .filter({ has: page.getByLabel("Opening balance", { exact: true }) });
      await f.getByLabel("Name", { exact: true }).fill("Large balance");
      await f
        .getByLabel("Opening balance", { exact: true })
        .fill("90071992547409.91");
      const posted = page.waitForResponse(
        (r) => r.url().endsWith("/accounts") && r.request().method() === "POST",
      );
      await f
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      assert.equal((await posted).status(), 201);
      await page
        .getByRole("button", { name: "View Large balance", exact: true })
        .waitFor();
      assert.ok(
        (
          await page
            .locator(".accountrow")
            .filter({
              has: page.getByRole("button", { name: "View Large balance" }),
            })
            .textContent()
        ).includes("90,071,992,547,409.91 RSD"),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await axe(page);
      await page.screenshot({
        path: join(artifacts, size + "-narrow.png"),
        fullPage: true,
      });
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(
    `Accounts browser verification passed (${checks.length} groups; desktop/mobile, axe, real Worker/D1).`,
  );
} catch (error) {
  console.error(error.stack || error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (fixture.exitCode === null) {
    const done = new Promise((resolve) => fixture.once("close", resolve));
    try {
      process.kill(-fixture.pid, "SIGTERM");
    } catch {}
    const timer = setTimeout(() => {
      try {
        process.kill(-fixture.pid, "SIGKILL");
      } catch {}
    }, 5000);
    await done;
    clearTimeout(timer);
  }
}
