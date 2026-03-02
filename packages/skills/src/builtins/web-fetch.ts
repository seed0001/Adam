import { tool } from "ai";
import { z } from "zod";

export const webFetchTool = tool({
  description:
    "Fetch the content of a URL and return its text. Useful for reading web pages, APIs, or checking URLs.",
  parameters: z.object({
    url: z.string().url().describe("The URL to fetch"),
    method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Request headers"),
    body: z.string().optional().describe("Request body for POST requests"),
  }),
  execute: async ({ url, method, headers, body }) => {
    const init: RequestInit = { method, signal: AbortSignal.timeout(15_000) };
    if (headers !== undefined) init.headers = headers;
    if (body !== undefined) init.body = body;

    const response = await fetch(url, init);

    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      body: text.slice(0, 50_000),
    };
  },
});
