import { TriggerTypes } from "deno-slack-api/mod.ts";
import { PollGuestInvitesWorkflow } from "../workflows/poll_guest_invites_workflow.ts";

/**
 * Scheduled trigger that runs every 15 minutes to poll
 * #slack-invites-approval for new guest invite requests.
 *
 * This replaces the message_posted event trigger, which does not
 * fire in the Nebius Enterprise Grid org.
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
