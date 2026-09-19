import { describe, expect, it, vi } from "vitest";
import { planChatContext } from "../server/chat-context";
import { NoUsableRouteError } from "../server/planner";
import { localChat } from "../server/providers";
import type { PlanRequest, PlanResponse } from "../shared/types";

const request = {} as PlanRequest;
const plan = {} as PlanResponse;

describe("optional companion route context", () => {
  it("continues without route context when the bundled map has no route", async () => {
    const buildPlan = vi.fn().mockRejectedValue(new NoUsableRouteError());

    await expect(planChatContext(request, buildPlan)).resolves.toBeUndefined();
    expect(buildPlan).toHaveBeenCalledWith(request);
    expect(localChat("Can you still help me?", undefined).message).toContain(
      "help without a mapped route",
    );
  });

  it("keeps a successful plan and propagates unrelated planner failures", async () => {
    await expect(
      planChatContext(request, vi.fn().mockResolvedValue(plan)),
    ).resolves.toBe(plan);
    await expect(
      planChatContext(
        request,
        vi.fn().mockRejectedValue(new Error("Feed unavailable")),
      ),
    ).rejects.toThrow("Feed unavailable");
  });
});
