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
    locale: "en-US",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  async function api(path, method, body, status, headers = {}) {
    const response = await page.request.fetch(`${base}/api/v1${path}`, {
      method,
      headers: { Origin: base, ...headers },
      ...(body === undefined ? {} : { data: body }),
    });
    const result = await response.text();
    assert.equal(response.status(), status, `${method} ${path}: ${result}`);
    return JSON.parse(result);
  }
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
                .locator(".pagehead")
                .getByRole("button", { name: "Add account", exact: true })
                .isEnabled(),
            );
          if (name === "Budgets")
            assert.ok(
              await page
                .getByRole("button", { name: "Add budget", exact: true })
                .isVisible(),
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
        await navigate("Dashboard");
        const opener = page.getByRole("button", {
          name: "Add transaction",
          exact: true,
        });
        await opener.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        for (const name of ["Paste SMS", "Upload image"])
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
      await page.getByText("Loading Reports…", { exact: true }).waitFor();
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
        .filter({ hasText: "The service is temporarily unavailable." })
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
      await navigate("Dashboard");
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
      await navigate("Transactions");
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
  await check(
    "manual expense, insufficient funds, stale edit and void on mobile",
    async () => {
      const selected = await page
        .getByLabel("Household", { exact: true })
        .inputValue();
      const path = `/households/${selected}`;
      const account = await api(
        `${path}/accounts`,
        "POST",
        {
          name: "Browser transaction cash",
          type: "cash",
          currency: "RSD",
          ownerMemberId: null,
          designation: "personal",
          openingBalanceMinor: "100000",
          openingDate: "2026-01-01",
        },
        201,
      );
      const category = await api(
        `${path}/categories`,
        "POST",
        { name: "Browser groceries", type: "expense" },
        201,
      );
      await page.reload();
      await page
        .getByLabel("Household", { exact: true })
        .selectOption(selected);
      await navigate("Dashboard");
      await page
        .getByRole("button", { name: "Add transaction", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByText("Enter manually", { exact: true })
        .click();
      await page.waitForURL("**/transactions**");
      const balance = async () =>
        (await api(`${path}/accounts/${account.id}`, "GET", undefined, 200))
          .balanceMinor;
      const editor = page.locator(".entry-form");
      const field = (name) => editor.getByLabel(name);
      const save = editor.getByRole("button", { name: "Save", exact: true });
      const transactionUrl = `${base}/api/v1${path}/transactions`;
      const mutation = (method, url = transactionUrl) =>
        page.waitForResponse(
          (response) =>
            response.url() === url && response.request().method() === method,
        );
      const submit = async (method, status, url) => {
        const pending = mutation(method, url);
        await save.click();
        const response = await pending;
        assert.equal(response.status(), status);
        return response.json();
      };
      const merchant = "Browser market 100%_";
      const creation = page.getByRole("dialog");
      await creation.waitFor();
      assert.notEqual(
        await creation.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      assert.ok(
        await creation.evaluate((el) => el.contains(document.activeElement)),
      );
      await editor.waitFor();
      assert.equal(await field("Account").inputValue(), account.id);
      const today = Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Belgrade",
        dateStyle: "short",
      }).format(new Date());
      assert.equal(await field("Date").inputValue(), today);
      await field("Category").selectOption(category.id);
      await field("Merchant").fill(merchant);
      await field("Amount").fill("1001.00");
      await submit("POST", 409);
      await creation
        .getByRole("alert")
        .filter({ hasText: "Insufficient funds" })
        .waitFor();
      assert.equal(await field("Amount").inputValue(), "1001.00");
      assert.equal(await balance(), "100000");
      await field("Amount").fill("12.34");
      await field("Amount").press("Tab");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await axe(page, "320px expense form");
      const created = await submit("POST", 201);
      assert.equal(created.amountMinor, "1234");
      await creation.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: merchant, exact: true }).waitFor();
      assert.equal(await balance(), "98766");

      const rowPath = `${path}/transactions/${created.id}`;
      const rowUrl = `${transactionUrl}/${created.id}`;
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await field("Amount").fill("20.00");
      await api(
        rowPath,
        "PATCH",
        {
          type: "expense",
          accountId: account.id,
          categoryId: category.id,
          currency: "RSD",
          exchangeRate: null,
          exchangeRateSource: null,
          transactionDate: created.transactionDate,
          merchant,
          note: "Changed elsewhere",
          version: created.version,
          amountMinor: "1300",
        },
        200,
      );
      await submit("PATCH", 409, rowUrl);
      const review = page.getByRole("button", {
        name: "I reviewed the current version",
      });
      await review.waitFor();
      assert.equal(await field("Amount").inputValue(), "20.00");
      assert.equal(await save.isDisabled(), true);
      await review.click();
      const edited = await submit("PATCH", 200, rowUrl);
      assert.equal(edited.amountMinor, "2000");
      assert.equal(await balance(), "98000");
      await page.getByRole("button", { name: "Void", exact: true }).waitFor();
      page.once("dialog", (dialog) => dialog.accept());
      const pendingVoid = mutation("POST", `${rowUrl}/void`);
      await page.getByRole("button", { name: "Void", exact: true }).click();
      assert.equal((await pendingVoid).status(), 200);
      assert.equal(await balance(), "100000");
      await page.getByLabel("Search", { exact: true }).fill("100%_");
      await page
        .getByRole("button", { name: "Apply filters", exact: true })
        .click();
      await page.getByRole("button", { name: merchant, exact: true }).waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await axe(page, "320px transaction list and detail");
      await screenshot(page, "mobile-manual-transaction");
    },
  );
  await check(
    "desktop income, transfer with fee, and linked refund",
    async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const selected = await page
        .getByLabel("Household", { exact: true })
        .inputValue();
      const path = `/households/${selected}`;
      const { accounts } = await api(`${path}/accounts`, "GET", undefined, 200);
      const cash = accounts.find(
        (account) => account.name === "Browser transaction cash",
      );
      assert(cash);
      const eur = await api(
        `${path}/accounts`,
        "POST",
        {
          name: "Browser euro account",
          type: "bank",
          currency: "EUR",
          ownerMemberId: null,
          designation: "personal",
          openingBalanceMinor: "0",
          openingDate: "2026-01-01",
        },
        201,
      );
      const income = await api(
        `${path}/categories`,
        "POST",
        { name: "Browser salary", type: "income" },
        201,
      );
      const { categories } = await api(
        `${path}/categories`,
        "GET",
        undefined,
        200,
      );
      const expense = categories.find(
        (category) => category.name === "Browser groceries",
      );
      assert(expense);
      const purchase = await api(
        `${path}/transactions`,
        "POST",
        {
          type: "expense",
          accountId: cash.id,
          categoryId: expense.id,
          currency: "RSD",
          amountMinor: "800",
          merchant: "Browser purchase",
          transactionDate: "2026-01-02",
        },
        201,
        { "Idempotency-Key": "browser-refund-purchase" },
      );
      await page.goto(`${base}/transactions`);
      await page
        .getByLabel("Household", { exact: true })
        .selectOption(selected);
      const editor = page.locator(".entry-form");
      const field = (name) => editor.getByLabel(name);
      const opener = page.getByRole("button", {
        name: "Add transaction",
        exact: true,
      });
      const dialog = page.getByRole("dialog");
      await opener.focus();
      await page.keyboard.press("Enter");
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.ok(await opener.evaluate((el) => el === document.activeElement));
      async function start(type) {
        await opener.click();
        await dialog.waitFor();
        await field("Type").selectOption(type);
      }
      async function save(merchant) {
        await field("Merchant").fill(merchant);
        const pending = page.waitForResponse(
          (response) =>
            response.url() === `${base}/api/v1${path}/transactions` &&
            response.request().method() === "POST",
        );
        await editor.getByRole("button", { name: "Save", exact: true }).click();
        const response = await pending;
        assert.equal(response.status(), 201, await response.text());
        await editor.waitFor({ state: "hidden" });
        return response.json();
      }
      await start("income");
      await field("Account").selectOption(eur.id);
      await field("Amount").fill("5.00");
      await field("Category").selectOption(income.id);
      await field("Exchange rate").fill("120");
      await field("Rate source").fill("Manual");
      assert.equal((await save("Browser income")).rsdEquivalentMinor, "60000");

      await start("transfer");
      await field("From account").selectOption(cash.id);
      await field("To account").selectOption(eur.id);
      await field("Debit amount").fill("600");
      await field("Credit amount").fill("5");
      await field("Fee amount (optional)").fill("1");
      await field("Fee category").selectOption(expense.id);
      await axe(page, "desktop transfer form");
      const transfer = await save("Browser transfer");
      assert.deepEqual(
        [
          transfer.debitAmountMinor,
          transfer.creditAmountMinor,
          transfer.fee.amountMinor,
        ],
        ["60000", "500", "100"],
      );

      await start("refund");
      await field("Purchase").selectOption(purchase.id);
      await field("Account").selectOption(cash.id);
      await field("Amount").fill("2.00");
      const refund = await save("Browser refund");
      assert.equal(refund.purchaseTransactionId, purchase.id);
      assert.equal(refund.categoryId, expense.id);
      assert.equal(refund.amountMinor, "200");
      assert.equal(
        (await api(`${path}/accounts/${cash.id}`, "GET", undefined, 200))
          .balanceMinor,
        "39300",
      );
      assert.equal(
        (await api(`${path}/accounts/${eur.id}`, "GET", undefined, 200))
          .balanceMinor,
        "1000",
      );
      await axe(page, "desktop transaction details");
      await screenshot(page, "desktop-manual-transactions");
    },
  );
  await check(
    "mobile reserve management and explicit revised expense funding",
    async () => {
      const id = await page
        .getByLabel("Household", { exact: true })
        .inputValue();
      const path = `/households/${id}`;
      const { accounts } = await api(`${path}/accounts`, "GET", undefined, 200);
      const account = accounts.find(
        (a) => a.name === "Browser transaction cash",
      );
      const { categories } = await api(
        `${path}/categories`,
        "GET",
        undefined,
        200,
      );
      const category = categories.find((c) => c.name === "Browser groceries");
      assert(account && category);
      await page.setViewportSize({ width: 320, height: 740 });
      await navigate("Reserves");
      await page
        .getByRole("button", { name: "Create reserve", exact: true })
        .click();
      const create = page.getByRole("dialog");
      await create
        .getByLabel("Name", { exact: true })
        .fill("Browser utilities");
      await create
        .getByLabel("Account", { exact: true })
        .selectOption(account.id);
      await create.getByRole("button", { name: "Save", exact: true }).click();
      await create.waitFor({ state: "hidden" });
      const { reserves } = await api(`${path}/reserves`, "GET", undefined, 200);
      const reserve = reserves.find((r) => r.name === "Browser utilities");
      assert(reserve);
      await page
        .getByRole("button", { name: "Allocate funds", exact: true })
        .click();
      const allocation = page.getByRole("dialog");
      await allocation.getByLabel("Amount", { exact: true }).fill("12.00");
      await allocation
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await allocation.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Release funds", exact: true })
        .click();
      const release = page.getByRole("dialog");
      await release.getByLabel("Amount", { exact: true }).fill("2.00");
      await release.getByRole("button", { name: "Save", exact: true }).click();
      await release.waitFor({ state: "hidden" });
      const funded = await api(
        `${path}/reserves/${reserve.id}`,
        "GET",
        undefined,
        200,
      );
      assert.equal(funded.balanceMinor, "1000");
      await axe(page, "320px reserves management");
      await navigate("Transactions");
      await page
        .getByRole("button", { name: "Add transaction", exact: true })
        .click();
      const expense = page.getByRole("dialog");
      await expense.getByLabel(/^Account/).selectOption(account.id);
      await expense.getByLabel(/^Category/).selectOption(category.id);
      await expense.getByLabel("Amount", { exact: true }).fill("15.00");
      await expense
        .getByLabel("Merchant", { exact: true })
        .fill("Browser reserve purchase");
      await expense
        .getByLabel(/^Reserve \(optional\)/)
        .selectOption(reserve.id);
      const reserveAmount = expense.getByLabel("Amount from reserve", {
        exact: true,
      });
      await reserveAmount.fill("8.00");
      await api(
        `${path}/reserves/${reserve.id}/movements`,
        "POST",
        { type: "release", amountMinor: "600" },
        201,
      );
      const save = expense.getByRole("button", { name: "Save", exact: true });
      async function submitFunded(expected) {
        const pending = page.waitForResponse(
          (response) =>
            response.url() === `${base}/api/v1${path}/transactions` &&
            response.request().method() === "POST",
        );
        await save.click();
        const response = await pending;
        assert.equal(response.status(), expected, await response.text());
        return response.json();
      }
      await submitFunded(409);
      assert.equal(await reserveAmount.inputValue(), "8.00");
      await expense
        .getByRole("button", { name: "Use revised allocation", exact: true })
        .click();
      assert.equal(Number(await reserveAmount.inputValue()), 4);
      await axe(page, "320px revised reserve funding");
      const posted = await submitFunded(201);
      assert.deepEqual(posted.reserveFunding, {
        reserveId: reserve.id,
        amountMinor: "400",
      });
      await expense.waitFor({ state: "hidden" });
      await navigate("Reserves");
      const refreshed = await api(
        `${path}/reserves/${reserve.id}`,
        "GET",
        undefined,
        200,
      );
      assert.equal(refreshed.balanceMinor, "0");
      await page
        .getByRole("button", { name: "Manage Browser utilities", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Movement history", exact: true })
        .waitFor();
      await page
        .locator(".detail")
        .getByText(/−4\.00\s+RSD/)
        .waitFor();
      await axe(page, "320px reserve movements");
      await screenshot(page, "mobile-reserves");
    },
  );
  await check(
    "monthly budget dialogs and recorded spending at 320px",
    async () => {
      const id = await page
        .getByLabel("Household", { exact: true })
        .inputValue();
      const path = `/households/${id}`;
      const month = "2025-10";
      const account = await api(
        `${path}/accounts`,
        "POST",
        {
          name: "Budget browser cash",
          type: "cash",
          currency: "RSD",
          ownerMemberId: null,
          designation: "personal",
          openingBalanceMinor: "500000",
          openingDate: `${month}-01`,
        },
        201,
      );
      const category = await api(
        `${path}/categories`,
        "POST",
        { name: "Budget browser groceries", type: "expense" },
        201,
      );
      await api(
        `${path}/transactions`,
        "POST",
        {
          type: "expense",
          transactionDate: `${month}-02`,
          accountId: account.id,
          categoryId: category.id,
          currency: "RSD",
          amountMinor: "200000",
        },
        201,
        { "Idempotency-Key": "browser-budget-expense" },
      );
      await page.setViewportSize({ width: 320, height: 740 });
      await navigate("Budgets");
      const picker = page.getByLabel("Month", { exact: true });
      await page.waitForFunction(() =>
        Boolean(document.querySelector('input[type="month"]')?.value),
      );
      assert.match(await picker.inputValue(), /^\d{4}-\d{2}$/);
      await picker.fill(month);
      const opener = page.getByRole("button", {
        name: "Add budget",
        exact: true,
      });
      await opener.click({ trial: true });
      await opener.focus();
      await opener.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/^Category/).selectOption(category.id);
      await dialog.getByLabel(/^Monthly limit/).fill("10000.00");
      await axe(page, "320px monthly budget dialog");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByText(/8,000\.00\s+RSD/).waitFor();
      await page
        .getByText(/20(?:\.00)?%/)
        .first()
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await axe(page, "320px monthly budget results");
      await screenshot(page, "mobile-budgets");
      await picker.fill("2025-11");
      await page
        .getByText(category.name, { exact: true })
        .waitFor({ state: "hidden" });
      await picker.fill(month);
      await page.getByText(category.name, { exact: true }).waitFor();
      await page.getByRole("button", { name: /^Edit budget/ }).click();
      await dialog.getByLabel(/^Monthly limit/).fill("1000.00");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page
        .getByText(/200(?:\.00)?%/)
        .first()
        .waitFor();
      const foreign = await api(
        `${path}/accounts`,
        "POST",
        {
          name: "Historical browser EUR",
          type: "cash",
          currency: "EUR",
          ownerMemberId: null,
          designation: "personal",
          openingBalanceMinor: "10000",
          openingDate: `${month}-01`,
        },
        201,
      );
      const { members } = await api(`${path}/members`, "GET", undefined, 200);
      const actor = members.find((member) => member.role === "owner");
      assert(actor);
      const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
      const legacyId = "verification-browser-budget-missing-fx";
      for (const sql of [
        `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,author_member_id,status,created_at,updated_at) VALUES (${quote(legacyId)},${quote(id)},'expense','${month}-03',${quote(category.id)},${quote(actor.id)},'posted','${month}-03','${month}-03')`,
        `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,created_at) VALUES ('verification-browser-budget-movement',${quote(id)},${quote(foreign.id)},${quote(legacyId)},'transaction','${month}-03',-100,'EUR','${month}-03')`,
      ]) {
        const seeded = await page.request.post(`${base}/_verification/sql`, {
          data: { sql },
        });
        assert.equal(seeded.status(), 200, await seeded.text());
      }
      await picker.fill("2025-11");
      await page.getByRole("progressbar").waitFor({ state: "hidden" });
      await picker.fill(month);
      await page.getByText(/Known spending subtotal/).waitFor();
      assert.equal(await page.getByRole("progressbar").count(), 0);
      await axe(page, "320px incomplete budget");
      page.once("dialog", (confirmation) => confirmation.accept());
      await page.getByRole("button", { name: /^Delete budget/ }).click();
      await page
        .getByText(category.name, { exact: true })
        .waitFor({ state: "hidden" });
    },
  );
  assert.deepEqual(pageErrors, [], "browser page errors");
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(
      {
        checks,
        axe: "Zero WCAG A/AA violations in the scanned route, chooser, form and detail states",
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
