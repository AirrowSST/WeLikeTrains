import type { PlanRequest, PlanResponse } from "../shared/types";
import { NoUsableRouteError, planJourney } from "./planner";

type PlanBuilder = (request: PlanRequest) => Promise<PlanResponse>;

export async function planChatContext(
  request?: PlanRequest,
  buildPlan: PlanBuilder = planJourney,
): Promise<PlanResponse | undefined> {
  if (!request) return undefined;
  try {
    return await buildPlan(request);
  } catch (error) {
    if (error instanceof NoUsableRouteError) return undefined;
    throw error;
  }
}
