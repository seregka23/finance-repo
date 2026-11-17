import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".cloudflare/localization-verification");
await mkdir(artifacts, { recursive: true });
// This existing fixture serves the production app against disposable local D1.
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
for (const stream of [fixture.stdout, fixture.stderr]) {
  stream.on("data", (data) => {
    logs = (logs + data).slice(-60000);
  });
}
const checks = [],
  errors = [];
const languageKey = "family-finance-language";
const copy = {
  en: {
    accounts: "Accounts",
    settings: "Household settings",
    amount: "90,071,992,547,409.91 RSD",
  },
  ru: {
    accounts: "Счета",
    settings: "Настройки семьи",
    amount: "90 071 992 547 409,91 RSD",
  },
  sr: {
    accounts: "Računi",
    settings: "Podešavanja domaćinstva",
    amount: "90.071.992.547.409,91 RSD",
  },
};
const normalized = (value) => value.replace(/[\u00a0\u202f]/g, " ");
async function check(name, run) {
  await run();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function change(page, language) {
  await page.locator("#app-language").selectOption(language);
  await page.waitForFunction(
    (expected) => document.documentElement.lang.split("-")[0] === expected,
    language,
  );
}
async function axe(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
  );
}
async function observe(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#app-language").waitFor();
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
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(base);
  await observe(page);
  await page.locator(".auth-choices").waitFor();

  await check(
    "anonymous language switch updates registration validation and persists across reload",
    async () => {
      await page.locator(".auth-choices button").nth(1).click();
      await page.locator("#auth-email").fill("localization@example.invalid");
      await page.locator("#auth-password").fill("First-fixture-password-2026!");
      await page
        .locator("#auth-confirmation")
        .fill("Second-fixture-password-2026!");
      await page.locator("app-auth-panel form button[type=submit]").click();
      const alert = page.locator("app-auth-panel [role=alert]");
      await alert.waitFor();
      const english = await alert.innerText();
      assert.match(english, /Passwords do not match/);
      for (const language of ["ru", "sr"]) {
        await change(page, language);
        await page.waitForFunction(
          (previous) =>
            document
              .querySelector("app-auth-panel [role=alert]")
              ?.textContent.trim() !== previous,
          english,
        );
        const translated = await alert.innerText();
        assert.notEqual(translated, english);
        assert.ok(!translated.includes("Passwords do not match"));
        assert.equal(
          await page.locator("#auth-email").inputValue(),
          "localization@example.invalid",
        );
        await axe(page);
      }
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), languageKey),
        "sr",
      );
      await page.reload();
      await page.locator(".auth-choices").waitFor();
      assert.equal(await page.locator("#app-language").inputValue(), "sr");
      assert.match(await page.locator("html").getAttribute("lang"), /^sr/);
      assert.equal(await page.title(), "Pregled | Family Finance");
    },
  );

  await check(
    "unknown API error uses localized fallback instead of raw server text",
    async () => {
      await change(page, "ru");
      await page.locator(".auth-choices button").first().click();
      await page.locator("#auth-email").fill("localization@example.invalid");
      await page.locator("#auth-password").fill("Fixture-password-2026!");
      await page.route("**/api/v1/auth/login", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "UNRECOGNIZED_PROVIDER_FAILURE",
              message: "Untranslated internal provider detail",
            },
          }),
        }),
      );
      await page.locator("app-auth-panel form button[type=submit]").click();
      const alert = page.locator("app-auth-panel [role=alert]");
      await alert.waitFor();
      const russian = await alert.innerText();
      assert.ok(
        russian.length > 0 &&
          !russian.includes("Untranslated internal provider detail"),
      );
      assert.match(russian, /[А-Яа-я]/);
      await change(page, "en");
      await page.waitForFunction(
        (previous) =>
          document
            .querySelector("app-auth-panel [role=alert]")
            ?.textContent.trim() !== previous,
        russian,
      );
      assert.ok(
        !(await alert.innerText()).includes(
          "Untranslated internal provider detail",
        ),
      );
      await page.unroute("**/api/v1/auth/login");
    },
  );

  await check(
    "invalid credentials show a specific localized error rather than session expiry",
    async () => {
      const responded = page.waitForResponse(
        (response) =>
          response.url().endsWith("/auth/login") &&
          response.request().method() === "POST",
      );
      await page.locator("app-auth-panel form button[type=submit]").click();
      assert.equal((await responded).status(), 401);
      const alert = page.locator("app-auth-panel [role=alert]");
      await page.waitForFunction(() =>
        document
          .querySelector("app-auth-panel [role=alert]")
          ?.textContent.includes("Invalid email or password."),
      );
      assert.equal(await alert.innerText(), "Invalid email or password.");
      for (const language of ["ru", "sr"]) {
        await change(page, language);
        assert.ok(
          !(await alert.innerText()).includes("Invalid email or password."),
        );
        assert.ok(
          !(await alert.innerText()).includes("Your session has ended"),
        );
      }
    },
  );
  await page.goto(base + "/_verification/sign-in/owner");
  await page.locator(".profile-menu").waitFor();
  const sessionResponse = await page.request.get(base + "/api/v1/session");
  assert.equal(sessionResponse.status(), 200);
  const session = await sessionResponse.json();
  const householdId = session.households[0].id;
  const selector = page.locator("#household-selector");
  if (await selector.count()) await selector.selectOption(householdId);
  const name = "Семейный Račun <cash>";
  const created = await page.request.post(
    `${base}/api/v1/households/${householdId}/accounts`,
    {
      headers: { Origin: base },
      data: {
        name,
        type: "cash",
        currency: "RSD",
        ownerMemberId: null,
        designation: "personal",
        openingBalanceMinor: "9007199254740991",
        openingDate: "2026-01-02",
      },
    },
  );
  const createdBody = await created.text();
  assert.equal(created.status(), 201, createdBody);
  const accountId = JSON.parse(createdBody).id;
  await page.locator('nav a[href="/accounts"]').click();
  await page.locator(".accountrow").filter({ hasText: name }).waitFor();
  for (const language of ["en", "ru", "sr"]) {
    await check(
      `${language}: account text, title, exact money and date-only history update without changing saved data`,
      async () => {
        await change(page, language);
        await page
          .getByRole("heading", { name: copy[language].accounts, exact: true })
          .waitFor();
        assert.match(await page.title(), new RegExp(copy[language].accounts));
        const row = page.locator(".accountrow").filter({ hasText: name });
        assert.ok(
          normalized(await row.innerText()).includes(copy[language].amount),
        );
        assert.equal(await row.locator(".account-link").innerText(), name);
        await row.locator(".account-link").click();
        const movement = page.locator(".movement").first();
        await movement.waitFor();
        const text = await movement.innerText();
        assert.ok(text.includes("2026"));
        assert.ok(
          !text.includes("2026-01-02"),
          "Date should be localized, not the raw ISO date",
        );
        if (language === "en")
          assert.match(text, /Jan(?:uary)? 2,? 2026|1\/2\/2026/);
        await axe(page);
        await page.screenshot({
          path: join(artifacts, language + "-accounts.png"),
          fullPage: true,
        });
      },
    );
  }
  await check(
    "Russian and Serbian decimal-comma input posts exact minor units",
    async () => {
      let expected = 9007199254740991n;
      for (const language of ["ru", "sr"]) {
        await change(page, language);
        const form = page
          .locator("form")
          .filter({ has: page.locator('input[formcontrolname="amount"]') });
        await form.locator('input[formcontrolname="amount"]').fill("-0,05");
        await form.locator('input[type="date"]').fill("2026-01-03");
        await form.locator('button[type="submit"]').click();
        await form.locator('[role="status"]').waitFor();
        const posted = page.waitForResponse(
          (response) =>
            response.url().endsWith("/adjustments") &&
            response.request().method() === "POST",
        );
        await form.locator('button[type="submit"]').click();
        const response = await posted;
        assert.equal(response.status(), 201);
        assert.equal(response.request().postDataJSON().amountMinor, "-5");
        expected -= 5n;
        const saved = await page.request.get(
          `${base}/api/v1/households/${householdId}/accounts/${accountId}`,
        );
        assert.equal(saved.status(), 200);
        assert.equal((await saved.json()).balanceMinor, expected.toString());
      }
    },
  );
  await check(
    "route title also changes when switching language on the same route",
    async () => {
      await page.goto(base + "/settings");
      await page
        .getByRole("heading", { name: copy.sr.settings, exact: true })
        .waitFor();
      await change(page, "ru");
      await page
        .getByRole("heading", { name: copy.ru.settings, exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).pathname, "/settings");
      assert.match(await page.title(), /Настройки семьи/);
      await change(page, "en");
      assert.match(await page.title(), /Household settings/);
    },
  );
  await page.setViewportSize({ width: 320, height: 812 });
  for (const language of ["ru", "sr"]) {
    await check(
      `${language}: narrow signed-in layout and accessible language control`,
      async () => {
        await change(page, language);
        await axe(page);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "Horizontal overflow at 320px",
        );
        await page.screenshot({
          path: join(artifacts, language + "-mobile.png"),
          fullPage: true,
        });
      },
    );
  }
  await context.close();
  for (const scenario of [
    { locale: "ru-RU", expected: "ru", storage: "invalid" },
    { locale: "sr-Latn-RS", expected: "sr", storage: "blocked" },
    { locale: "fr-FR", expected: "en", storage: "empty" },
  ]) {
    await check(
      `${scenario.locale}: initial browser-language fallback with ${scenario.storage} preference`,
      async () => {
        const other = await browser.newContext({ locale: scenario.locale });
        if (scenario.storage === "invalid")
          await other.addInitScript(
            (key) => localStorage.setItem(key, "not-supported"),
            languageKey,
          );
        if (scenario.storage === "blocked")
          await other.addInitScript(() => {
            Object.defineProperty(window, "localStorage", {
              get() {
                throw new DOMException(
                  "Fixture blocked storage",
                  "SecurityError",
                );
              },
            });
          });
        const tab = await other.newPage();
        tab.on("pageerror", (error) => errors.push(error.message));
        await tab.goto(base);
        await tab.locator(".auth-choices").waitFor();
        assert.equal(
          await tab.locator("#app-language").inputValue(),
          scenario.expected,
        );
        await change(tab, "ru");
        await other.close();
      },
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(
    `Localization browser verification passed (${checks.length} groups; Chromium, axe, native Worker/local D1).`,
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
