"use server";

import { randomUUID } from "node:crypto";
import {
  opportunityFeedbackActions,
  opportunityFeedbackDismissReasons,
  type OpportunityFeedbackAction,
  type OpportunityFeedbackDismissReason,
  type OpportunityFeedbackMutationRequest,
  type OpportunityFeedbackResponse,
} from "@developer-brand-copilot/contracts";
import { redirect } from "next/navigation";
import {
  authenticatedApiRequest,
  AuthenticatedApiError,
} from "../../lib/api/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionSet = new Set<OpportunityFeedbackAction>(opportunityFeedbackActions);
const reasonSet = new Set<OpportunityFeedbackDismissReason>(opportunityFeedbackDismissReasons);

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function feedbackErrorCode(error: unknown): string {
  if (!(error instanceof AuthenticatedApiError)) return "feedback_failed";
  if (error.status === 400) return "feedback_invalid";
  if (error.status === 404) return "feedback_unavailable";
  if (error.status === 409) {
    if (error.code === "FEEDBACK_IDEMPOTENCY_CONFLICT") return "feedback_idempotency_conflict";
    if (error.code === "FEEDBACK_NOT_ACTIONABLE") return "feedback_stale";
    return "feedback_conflict";
  }
  return "feedback_failed";
}

export async function submitOpportunityFeedback(formData: FormData): Promise<never> {
  const projectId = formText(formData, "projectId");
  const opportunityId = formText(formData, "opportunityId");
  const action = formText(formData, "action");
  const reasonValue = formText(formData, "reason");
  if (!uuidPattern.test(projectId) || !uuidPattern.test(opportunityId) || !actionSet.has(action as OpportunityFeedbackAction)) {
    redirect("/dashboard?error=feedback_invalid");
  }

  const feedbackAction = action as OpportunityFeedbackAction;
  let request: OpportunityFeedbackMutationRequest;
  if (feedbackAction === "accepted") {
    request = { action: "accepted" };
  } else if (reasonValue === "") {
    request = { action: "dismissed" };
  } else if (reasonSet.has(reasonValue as OpportunityFeedbackDismissReason)) {
    request = { action: "dismissed", reason: reasonValue as OpportunityFeedbackDismissReason };
  } else {
    redirect(`/dashboard?projectId=${encodeURIComponent(projectId)}&error=feedback_invalid`);
  }

  try {
    await authenticatedApiRequest<OpportunityFeedbackResponse>(
      `/projects/${encodeURIComponent(projectId)}/opportunities/${encodeURIComponent(opportunityId)}/feedback`,
      {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: JSON.stringify(request),
      },
    );
  } catch (error) {
    redirect(`/dashboard?projectId=${encodeURIComponent(projectId)}&error=${feedbackErrorCode(error)}`);
  }

  redirect(`/dashboard?projectId=${encodeURIComponent(projectId)}&status=opportunity_${feedbackAction}`);
}
