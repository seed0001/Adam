import { describe, it, expect, vi } from "vitest";
import { ok, err, adamError } from "@adam/shared";
import { Planner } from "../planner.js";
import type { ModelRouter } from "@adam/models";

function makeRouter(response: ReturnType<typeof ok> | ReturnType<typeof err>) {
  return {
    generateObject: vi.fn().mockResolvedValue(response),
  } as unknown as ModelRouter;
}

/** Build a minimal raw task node matching PlanSchema */
function rawTask(
  id: string,
  dependsOn: string[] = [],
  modelTier: "fast" | "capable" = "capable",
) {
  return { id, description: `Task ${id}`, dependsOn, modelTier, tools: [] };
}

describe("Planner", () => {
  it("propagates router errors as Err", async () => {
    const router = makeRouter(err(adamError("router:failed", "model unavailable")));
    const planner = new Planner(router);

    const result = await planner.plan("do something", "session-1");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("router:failed");
  });

  it("returns a valid TaskGraph for a single-task plan", async () => {
    const router = makeRouter(
      ok({ tasks: [rawTask("t1")], reasoning: "Simple single task." }),
    );
    const planner = new Planner(router);
    const result = await planner.plan("say hello", "session-1");

    expect(result.isOk()).toBe(true);
    const graph = result._unsafeUnwrap();
    expect(graph.tasks).toHaveLength(1);
    expect(graph.rootGoal).toBe("say hello");
    expect(graph.status).toBe("building");
  });

  it("sets default fields on each task (status, retryCount, etc.)", async () => {
    const router = makeRouter(
      ok({ tasks: [rawTask("t1")], reasoning: "." }),
    );
    const planner = new Planner(router);
    const graph = (await planner.plan("goal", "s"))._unsafeUnwrap();
    const task = graph.tasks[0]!;

    expect(task.status).toBe("pending");
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(2);
    expect(task.complexity).toBe("simple");
    expect(task.priority).toBe("normal");
    expect(task.parentId).toBeNull();
  });

  it("calls generateObject with tier:'capable' and the goal as prompt", async () => {
    const router = makeRouter(
      ok({ tasks: [rawTask("t1")], reasoning: "." }),
    );
    const planner = new Planner(router);
    await planner.plan("my goal", "session-1");

    expect(router.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "capable",
        prompt: "Goal: my goal",
      }),
    );
  });

  // ── DAG validation ──────────────────────────────────────────────────────────

  it("returns planner:invalid-dag if a task depends on an unknown ID", async () => {
    const router = makeRouter(
      ok({
        tasks: [rawTask("t1", ["ghost-id"])],
        reasoning: ".",
      }),
    );
    const planner = new Planner(router);
    const result = await planner.plan("goal", "s");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("planner:invalid-dag");
  });

  it("accepts a valid linear chain A → B → C", async () => {
    const router = makeRouter(
      ok({
        tasks: [rawTask("a"), rawTask("b", ["a"]), rawTask("c", ["b"])],
        reasoning: ".",
      }),
    );
    const planner = new Planner(router);
    const result = await planner.plan("chain", "s");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().tasks).toHaveLength(3);
  });

  it("detects a direct cycle A → B → A", async () => {
    const router = makeRouter(
      ok({
        tasks: [rawTask("a", ["b"]), rawTask("b", ["a"])],
        reasoning: ".",
      }),
    );
    const planner = new Planner(router);
    const result = await planner.plan("cycle", "s");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("planner:cycle-detected");
  });

  it("detects a self-referencing task (A depends on itself)", async () => {
    const router = makeRouter(
      ok({ tasks: [rawTask("a", ["a"])], reasoning: "." }),
    );
    const planner = new Planner(router);
    const result = await planner.plan("self loop", "s");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("planner:cycle-detected");
  });

  it("accepts an empty task list without error", async () => {
    const router = makeRouter(ok({ tasks: [], reasoning: "Nothing to do." }));
    const planner = new Planner(router);
    const result = await planner.plan("empty plan", "s");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().tasks).toHaveLength(0);
  });

  it("accepts a diamond DAG (A → B, A → C, B + C → D)", async () => {
    const router = makeRouter(
      ok({
        tasks: [
          rawTask("a"),
          rawTask("b", ["a"]),
          rawTask("c", ["a"]),
          rawTask("d", ["b", "c"]),
        ],
        reasoning: ".",
      }),
    );
    const planner = new Planner(router);
    const result = await planner.plan("diamond", "s");
    expect(result.isOk()).toBe(true);
  });
});
