import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { homedir } from "node:os";
import { ADAM_HOME_DIR, createLogger } from "@adam/shared";

const logger = createLogger("browser");

// ── Content extraction ────────────────────────────────────────────────────────

const EXTRACT_SCRIPT = /* js */ `(() => {
  const clone = document.body.cloneNode(true);
  for (const el of clone.querySelectorAll(
    'script,style,noscript,svg,canvas,video,audio,nav,footer,aside,[aria-hidden="true"]'
  )) el.remove();
  return clone.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
})()`;

// ── BrowserSession ────────────────────────────────────────────────────────────

/**
 * Wraps a single persistent Playwright browser + page.
 *
 * The browser is started lazily on the first tool call and reused for all
 * subsequent calls in the same daemon run.  Headed (visible) by default so
 * the user can watch Adam navigate in real time.
 *
 * Content extraction strips nav/footer/script noise and caps at 10 000 chars
 * so the LLM context stays manageable.
 */
export class BrowserSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly headless: boolean;
  private readonly contentLimit: number;

  constructor(headless = false, contentLimit = 10_000) {
    this.headless = headless;
    this.contentLimit = contentLimit;
  }

  // ── Core helpers ────────────────────────────────────────────────────────────

  async getPage(): Promise<Page> {
    if (!this.context) {
      const userDataDir = join(homedir(), ADAM_HOME_DIR, "suno_browser_data");
      const launchOpts = {
        headless: this.headless,
        args: ["--disable-blink-features=AutomationControlled"],
      };

      try {
        logger.info(`Launching persistent browser context (channel=chrome, dir=${userDataDir})`);
        this.context = await chromium.launchPersistentContext(userDataDir, {
          ...launchOpts,
          channel: "chrome",
        });
        this.context.on("close", () => {
          this.context = null;
          this.page = null;
        });
      } catch {
        try {
          logger.info("Chrome not found, trying Microsoft Edge (persistent)");
          this.context = await chromium.launchPersistentContext(userDataDir, {
            ...launchOpts,
            channel: "msedge",
          });
          this.context.on("close", () => {
            this.context = null;
            this.page = null;
          });
        } catch {
          logger.warn(
            "Chrome/Edge not found — using Chromium (persistent). Sign-in may be blocked."
          );
          this.context = await chromium.launchPersistentContext(userDataDir, {
            headless: this.headless,
            args: [
              "--no-sandbox",
              "--disable-dev-shm-usage",
              "--disable-blink-features=AutomationControlled",
            ],
          });
          this.context.on("close", () => {
            this.context = null;
            this.page = null;
          });
        }
      }
    }

    if (!this.page || this.page.isClosed()) {
      // launchPersistentContext usually opens a page automatically
      this.page = this.context.pages()[0] || (await this.context.newPage());
      await this.page.setViewportSize({ width: 1280, height: 800 });
      logger.info("Browser page ready (persistent)");
    }
    return this.page;
  }

  private async extractContent(page: Page): Promise<string> {
    try {
      const raw = await page.evaluate(EXTRACT_SCRIPT);
      return (typeof raw === 'string' ? raw : "").slice(0, this.contentLimit);
    } catch {
      const fallback = await page.innerText("body").catch(() => "");
      return fallback.slice(0, this.contentLimit);
    }
  }

  // ── Public API (each method maps 1:1 to a tool) ──────────────────────────────

  async navigate(url: string): Promise<PageResult> {
    const page = await this.getPage();
    logger.info(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return this.pageResult(page);
  }

  async click(selectorOrText: string): Promise<PageResult> {
    const page = await this.getPage();
    logger.info(`Click: ${selectorOrText}`);
    try {
      await page.click(selectorOrText, { timeout: 5_000 });
    } catch {
      // Fall back to visible text match
      await page.getByText(selectorOrText, { exact: false }).first().click({ timeout: 5_000 });
    }
    await page.waitForLoadState("domcontentloaded").catch(() => { });
    return this.pageResult(page);
  }

  async type(selector: string, text: string, submit = false): Promise<{ typed: string; into: string; url: string }> {
    const page = await this.getPage();
    logger.info(`Type "${text}" into ${selector}`);
    await page.fill(selector, text);
    if (submit) await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => { });
    return { typed: text, into: selector, url: page.url() };
  }

  async getContent(): Promise<PageResult> {
    const page = await this.getPage();
    return this.pageResult(page);
  }

  async screenshot(savePath: string): Promise<{ saved: string }> {
    const page = await this.getPage();
    await page.screenshot({ path: savePath, fullPage: false });
    logger.info(`Screenshot saved to ${savePath}`);
    return { saved: savePath };
  }

  async scroll(direction: "up" | "down", pixels = 600): Promise<{ scrolled: string; url: string }> {
    const page = await this.getPage();
    await page.evaluate(
      ({ dir, px }: { dir: string; px: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
        (window as any).scrollBy(0, dir === "down" ? px : -px);
      },
      { dir: direction, px: pixels },
    );
    return { scrolled: `${direction} ${pixels}px`, url: page.url() };
  }

  async goBack(): Promise<PageResult> {
    const page = await this.getPage();
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
    return this.pageResult(page);
  }

  async goForward(): Promise<PageResult> {
    const page = await this.getPage();
    await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 });
    return this.pageResult(page);
  }

  async newTab(url?: string): Promise<PageResult> {
    if (!this.context) await this.getPage();
    this.page = await this.context!.newPage();
    await this.page.setViewportSize({ width: 1280, height: 800 });
    if (url) {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    return this.pageResult(this.page);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => { });
      this.context = null;
      this.page = null;
      logger.info("Browser session (persistent) closed");
    }
  }

  isOpen(): boolean {
    return this.context !== null && this.page?.isClosed() === false;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private async pageResult(page: Page): Promise<PageResult> {
    const [title, content] = await Promise.all([
      page.title().catch(() => ""),
      this.extractContent(page),
    ]);
    return { title, url: page.url(), content };
  }
}

export type PageResult = {
  title: string;
  url: string;
  /** Cleaned visible text, capped at contentLimit chars */
  content: string;
};
