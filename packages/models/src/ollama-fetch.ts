/**
 * Custom fetch for Ollama with no timeout.
 * Node/undici default headersTimeout (300s) causes timeouts for slow models like DeepSeek Coder V2.
 */
import { fetch as undiciFetch, Agent } from "undici";

const agent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 60_000,
});

export const ollamaFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  undiciFetch(input, { ...init, dispatcher: agent })) as typeof fetch;
