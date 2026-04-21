import { TriggerTypes } from "deno-slack-api/mod.ts";
import { PollGuestInvitesWorkflow } from "../workflows/poll_guest_invites_workflow.ts";

/**
 * Scheduled trigger that runs hourly to poll
 * the invite approval channel for new guest invite requests.
 *
 * Acts as a backup to the event trigger for any missed messages.
 * This path is shadow-only — it never calls approve/deny APIs.
 */
// deno-lint-ignore no-explicit-any
const PollGuestInvitesTrigger: Record<string, any> = {
  type: TriggerTypes.Scheduled,
  name: "Poll Guest Invites Trigger",
  description: "Runs every hour to check for new guest invite requests",
  workflow: `#/workflows/${PollGuestInvitesWorkflow.definition.callback_id}`,
  schedule: {
    start_time: "2026-03-31T03:00:00Z",
    frequency: {
      type: "hourly",
      repeats_every: 1,
    },
  },
};

export default PollGuestInvitesTrigger;
