import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".cloudflare/auth-verification");
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
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await check(
      `${size}: public welcome, sign-in and registration are accessible`,
      async () => {
        await page.goto(base);
        await page
          .getByRole("button", { name: "Create account", exact: true })
          .waitFor();
        await axe(page);
        await page.screenshot({
          path: join(artifacts, `${size}-welcome.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.getByLabel("Email address").waitFor();
        await axe(page);
        await page.screenshot({
          path: join(artifacts, `${size}-login.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", {
            name: "Need an account? Create account",
            exact: true,
          })
          .click();
        await page.getByLabel("Confirm password").waitFor();
        await axe(page);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: join(artifacts, `${size}-register.png`),
          fullPage: true,
        });
      },
    );
    const email = `browser-${size}@example.invalid`;
    await check(
      `${size}: register, persist session, logout, reject wrong password, sign in`,
      async () => {
        await page.getByLabel("Email address").fill(email);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByLabel("Confirm password").fill(password + "mismatch");
        await page
          .getByRole("button", { name: "Create account", exact: true })
          .click();
        await page
          .getByText("Passwords do not match. Please check and try again.", {
            exact: true,
          })
          .waitFor();
        await page.getByLabel("Confirm password").fill(password);
        await page
          .getByRole("button", { name: "Create account", exact: true })
          .click();
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .waitFor();
        const cookies = await context.cookies();
        assert.ok(
          cookies.some(
            (c) =>
              c.name === "finance_session" &&
              c.httpOnly &&
              c.sameSite === "Lax",
          ),
        );
        await page.reload();
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .waitFor();
        await page.locator(".profile-menu summary").click();
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .waitFor();
        assert.ok(
          !(await context.cookies()).some((c) => c.name === "finance_session"),
        );
        const unauthorized = await context.request.get(
          base + "/api/v1/session",
        );
        assert.equal(unauthorized.status(), 401);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.getByLabel("Email address").fill(email);
        await page
          .getByLabel("Password", { exact: true })
          .fill("Wrong-password-2026!");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page
          .getByText("Invalid email or password", { exact: true })
          .waitFor();
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .waitFor();
        assert.equal(await page.evaluate(() => localStorage.length), 0);
      },
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(artifacts, "results.json"),
    JSON.stringify({ checks, pageErrors: errors }, null, 2),
  );
  console.log(
    `Native authentication browser verification passed (${checks.length} groups).`,
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
