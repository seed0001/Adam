import { describe, it, expect, vi } from "vitest";
import { ok, err, adamError } from "@adam/shared";
import { IntentClassifier } from "../classifier.js";
import type { ModelRouter } from "@adam/models";

function makeRouter(response: any) {
  return {
    generateObject: vi.fn().mockResolvedValue(response),
  } as unknown as ModelRouter;
}

describe("IntentClassifier", () => {
  it("propagates router errors as Err", async () => {
    const router = makeRouter(err<any, any>(adamError("router:failed", "model unavailable")));
    const classifier = new IntentClassifier(router);

    const result = await classifier.classify("hello", "session-1");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("router:failed");
  });

  it("returns a ClassificationResult on success", async () => {
    const router = makeRouter(
      ok({
        complexity: "trivial",
        intent: "general",
        reasoning: "It's just a hello.",
        suggestedTier: "fast",
        requiresPlanning: false,
      }),
    );
    const classifier = new IntentClassifier(router);

    const result = await classifier.classify("hello", "session-1");
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.complexity).toBe("trivial");
    expect(value.tier).toBe("fast");
    expect(value.requiresPlanning).toBe(false);
  });

  it("maps suggestedTier to the tier field", async () => {
    const router = makeRouter(
      ok({
        complexity: "complex",
        intent: "build",
        reasoning: "Needs tool use.",
        suggestedTier: "capable",
        requiresPlanning: true,
      }),
    );
    const classifier = new IntentClassifier(router);

    const result = await classifier.classify("do something complex", "s");
    expect(result._unsafeUnwrap().tier).toBe("capable");
  });

  it("calls generateObject with tier:'fast'", async () => {
    const router = makeRouter(
      ok({ complexity: "trivial", intent: "general", reasoning: ".", suggestedTier: "fast", requiresPlanning: false }),
    );
    const classifier = new IntentClassifier(router);
    await classifier.classify("test input", "session-abc");

    expect(router.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "fast" }),
    );
  });

  it("passes the input string as the prompt", async () => {
    const router = makeRouter(
      ok({ complexity: "simple", intent: "general", reasoning: ".", suggestedTier: "fast", requiresPlanning: false }),
    );
    const classifier = new IntentClassifier(router);
    const input = "what is the weather today?";
    await classifier.classify(input, "session-xyz");

    expect(router.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: input }),
    );
  });
});
