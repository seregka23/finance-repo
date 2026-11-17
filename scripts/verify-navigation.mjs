import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts =
  process.env.FINANCE_NAVIGATION_ARTIFACT_DIR ??
  join(root, ".cloudflare/navigation-verification");
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
let logs = "";
fixture.stdout.on("data", (value) => {
  logs = (logs + value).slice(-60000);
});
fixture.stderr.on("data", (value) => {
  logs = (logs + value).slice(-60000);
});
let browser;
const pageErrors = [];
const checks = [];
const names = [
  "Dashboard",
  "Accounts",
  "Transactions",
  "Budgets",
  "Reserves",
  "Reports",
];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function axe(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
    `${label} accessibility`,
  );
}
async function screenshot(page, name) {
  await page.screenshot({
    path: join(artifacts, name + ".png"),
    fullPage: true,
  });
}
function signal(name) {
  if (fixture.exitCode === null && fixture.signalCode === null) {
    try {
      process.kill(
        process.platform === "win32" ? fixture.pid : -fixture.pid,
        name,
      );
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
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
async function executable() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  for (const path of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ]) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  return undefined; // Playwright's installed Chromium, when present.
}
async function run() {
  const deadline = Date.now() + 180000;
  let base;
  while (Date.now() < deadline) {
    const match = logs.match(
      /Browser verification fixture ready: (http:\/\/127\.0\.0\.1:\d+)\//,
    );
    if (match) {
      base = match[1];
      break;
    }
    if (fixture.exitCode !== null)
      throw new Error(`Signed fixture failed:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(base, `Timed out waiting for native fixture:\n${logs}`);
  console.log("Native Worker/D1 fixture passed its access checks.");
  browser = await chromium.launch({
    executablePath: await executable(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const nav = () => page.getByRole("navigation", { name: "Main navigation" });
  async function navigate(name) {
    const changed = new URL(page.url()).pathname !== "/" + name.toLowerCase();
    await nav().getByRole("link", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
    if (changed)
      await page.waitForFunction(
        () => document.activeElement?.tagName === "H1",
      );
    assert.equal(
      await nav().locator('[aria-current="page"]').innerText(),
      name,
    );
    assert.equal(new URL(page.url()).pathname, "/" + name.toLowerCase());
    assert.equal(await page.title(), `${name} | Family Finance`);
  }
  await check(
    "no-household guidance leads to real household creation",
    async () => {
      await page.goto(base + "/_verification/sign-in/newcomer");
      await page
        .getByRole("heading", { name: "Create your household", exact: true })
        .waitFor();
      await page
        .getByRole("link", { name: "Create household", exact: true })
        .click();
      await page
        .getByLabel("Household name")
        .fill("Navigation verification household");
      await page
        .getByRole("button", { name: "Create household", exact: true })
        .click();
      await page.getByText("Household created.", { exact: true }).waitFor();
      await navigate("Dashboard");
      await page.getByText("No transactions yet.", { exact: true }).waitFor();
      assert.match(await page.locator(".amount").innerText(), /0\.00\s+RSD/);
    },
  );
  for (const [size, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await check(
      `${size}: all six routes, first-use states, titles and current links`,
      async () => {
        assert.deepEqual(
          await nav()
            .getByRole("link")
            .evaluateAll((links) =>
              links.map((link) => link.getAttribute("aria-label")),
            ),
          names,
        );
        for (const name of names) {
          await navigate(name);
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${size} ${name} overflow`,
          );
          for (const link of await nav().getByRole("link").all()) {
            const bounds = await link.boundingBox();
            assert.ok(
              bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
              `${size} navigation clipping`,
            );
          }
          if (name === "Accounts")
            assert.ok(
              await page
                .getByRole("button", { name: "Add account", exact: true })
                .isDisabled(),
            );
          if (name === "Budgets")
            assert.ok(
              await page
                .getByRole("button", { name: "Add budget", exact: true })
                .isDisabled(),
            );
          if (name === "Reserves")
            assert.ok(
              await page
                .getByRole("button", { name: "Create reserve", exact: true })
                .isDisabled(),
            );
          const colors = await nav()
            .getByRole("link")
            .evaluateAll((links) =>
              links.map((link) => ({
                current: link.getAttribute("aria-current") === "page",
                background: getComputedStyle(link).backgroundColor,
              })),
            );
          assert.equal(
            colors.filter((link) => link.background === "rgb(48, 62, 105)")
              .length,
            1,
            "Only the current destination is visually selected",
          );
          assert.ok(
            colors.find((link) => link.current)?.background ===
              "rgb(48, 62, 105)",
          );
          if (name === "Dashboard") await screenshot(page, `${size}-dashboard`);
          if (size === "mobile" && name === "Reports")
            await screenshot(page, "mobile-reports");
          await axe(page, `${size} ${name}`);
        }
      },
    );
    await check(
      `${size}: transaction chooser keyboard containment, Escape and focus restoration`,
      async () => {
        await navigate("Transactions");
        const opener = page.getByRole("button", {
          name: "Add transaction",
          exact: true,
        });
        await opener.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        for (const name of ["Enter manually", "Paste SMS", "Upload image"])
          assert.ok(
            await dialog
              .getByRole("button", { name, exact: true })
              .isDisabled(),
          );
        assert.ok(
          await dialog
            .getByRole("link", { name: "Go to accounts", exact: true })
            .isVisible(),
        );
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press("Tab");
          assert.ok(
            await page.evaluate(
              () => !!document.activeElement?.closest("dialog"),
            ),
          );
        }
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press("Shift+Tab");
          assert.ok(
            await page.evaluate(
              () => !!document.activeElement?.closest("dialog"),
            ),
          );
        }
        await axe(page, `${size} chooser`);
        if (size === "mobile") await screenshot(page, "mobile-chooser");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.ok(
          await opener.evaluate(
            (element) => element === document.activeElement,
          ),
        );
        await opener.click();
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        assert.ok(
          await opener.evaluate(
            (element) => element === document.activeElement,
          ),
        );
      },
    );
  }
  await check(
    "profile settings entry, refresh and browser history",
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator("summary").click();
      await page
        .locator(".profile-links")
        .getByRole("link", { name: "Household settings", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "Household settings",
          exact: true,
          level: 1,
        })
        .waitFor();
      assert.equal(
        await page.locator(".profile-menu").getAttribute("open"),
        null,
      );
      assert.equal(await nav().locator('[aria-current="page"]').count(), 0);
      assert.ok(
        await nav()
          .getByRole("link")
          .evaluateAll((links) =>
            links.every(
              (link) =>
                getComputedStyle(link).backgroundColor !== "rgb(48, 62, 105)",
            ),
          ),
      );
      await screenshot(page, "desktop-settings");
      await axe(page, "settings");
      await navigate("Accounts");
      await navigate("Reports");
      await page.goBack();
      await page
        .getByRole("heading", { name: "Accounts", level: 1, exact: true })
        .waitFor();
      await page.goForward();
      await page
        .getByRole("heading", { name: "Reports", level: 1, exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole("heading", { name: "Reports", level: 1, exact: true })
        .waitFor();
    },
  );
  await check(
    "loading, failure and retry remain distinct from empty data",
    async () => {
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/workspace", async (route) => {
        await held;
        await route.continue();
      });
      const reload = page.reload();
      await page.getByText("Loading reports…", { exact: true }).waitFor();
      assert.equal(await page.locator(".empty").count(), 0);
      release();
      await reload;
      await page.getByText(/No transactions yet\. Reports/).waitFor();
      await page.unroute("**/workspace");
      let fail = true;
      await page.route("**/workspace", async (route) => {
        if (fail)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "DATABASE_UNAVAILABLE",
                message: "Workspace unavailable. Please retry.",
              },
            }),
          });
        else await route.continue();
      });
      await page.reload();
      await page
        .getByRole("alert")
        .filter({ hasText: "Workspace unavailable" })
        .waitFor();
      assert.equal(await page.locator(".empty").count(), 0);
      fail = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByText(/No transactions yet\. Reports/).waitFor();
      await page.unroute("**/workspace");
    },
  );
  await check(
    "320px reflow and changing households closes the dialog",
    async () => {
      const created = await page.evaluate(async () => {
        const response = await fetch("/api/v1/households", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Another household with a deliberately long visible name",
          }),
        });
        if (response.status !== 201)
          throw new Error("Fixture household creation failed");
        return response.json();
      });
      await page.reload();
      await page
        .getByRole("heading", { name: "Reports", level: 1, exact: true })
        .waitFor();
      await page.setViewportSize({ width: 320, height: 740 });
      await navigate("Transactions");
      await page
        .getByRole("button", { name: "Add transaction", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      // A membership change from another tab can occur while a modal is open.
      // Exercise the actual select event to verify stale modal state is closed.
      await page
        .getByLabel("Household", { exact: true })
        .evaluate((select, id) => {
          select.value = id;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, created.id);
      await dialog.waitFor({ state: "hidden" });
      await page
        .getByText(
          "Start by adding an account before recording transactions.",
          { exact: true },
        )
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "320px layout overflow",
      );
      await screenshot(page, "narrow-transactions");
      await axe(page, "320px transactions with household selector");
    },
  );
  assert.deepEqual(pageErrors, [], "browser page errors");
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(
      {
        checks,
        axe: "Zero WCAG A/AA violations in 12 route states, two chooser states, settings and 320px household switching",
        pageErrors,
        fixture: "actual local Worker/D1 with native synthetic accounts",
      },
      null,
      2,
    ),
  );
  console.log(
    `Navigation verification passed (${checks.length} groups). Artifacts: ${artifacts}`,
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
} catch (error) {
  console.error(error.stack ?? error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  await stop();
}
