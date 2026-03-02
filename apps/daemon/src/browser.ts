import { chromium, type Browser, type Page } from "playwright";
import { createLogger } from "@adam/shared";

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
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly headless: boolean;
  private readonly contentLimit: number;

  constructor(headless = false, contentLimit = 10_000) {
    this.headless = headless;
    this.contentLimit = contentLimit;
  }

  // ── Core helpers ────────────────────────────────────────────────────────────

  async getPage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      logger.info(`Launching Chromium (headless=${this.headless})`);
      this.browser = await chromium.launch({
        headless: this.headless,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.browser.newPage();
      await this.page.setViewportSize({ width: 1280, height: 800 });
      logger.info("New browser page created");
    }
    return this.page;
  }

  private async extractContent(page: Page): Promise<string> {
    try {
      const raw = (await page.evaluate(EXTRACT_SCRIPT)) as string;
      return raw.slice(0, this.contentLimit);
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
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return this.pageResult(page);
  }

  async type(selector: string, text: string, submit = false): Promise<{ typed: string; into: string; url: string }> {
    const page = await this.getPage();
    logger.info(`Type "${text}" into ${selector}`);
    await page.fill(selector, text);
    if (submit) await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
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
      ({ dir, px }: { dir: string; px: number }) => window.scrollBy(0, dir === "down" ? px : -px),
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
    if (!this.browser || !this.browser.isConnected()) await this.getPage();
    this.page = await this.browser!.newPage();
    await this.page.setViewportSize({ width: 1280, height: 800 });
    if (url) {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    return this.pageResult(this.page);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
      logger.info("Browser session closed");
    }
  }

  isOpen(): boolean {
    return this.browser?.isConnected() === true && this.page?.isClosed() === false;
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
