import { TriggerTypes } from "deno-slack-api/mod.ts";
import { GuestInviteShadowWorkflow } from "../workflows/guest_invite_shadow_workflow.ts";

/**
 * Event trigger for message_posted in #slack-invites-approval.
 * Fires on every new or updated message, passing the event data
 * to the shadow mode workflow for real-time processing.
 */
// deno-lint-ignore no-explicit-any
const GuestInviteMessageTrigger: Record<string, any> = {
  type: TriggerTypes.Event,
  name: "Guest Invite Message Trigger",
  description:
    "Fires on new or updated messages in #slack-invites-approval for real-time shadow mode processing",
  workflow: `#/workflows/${GuestInviteShadowWorkflow.definition.callback_id}`,
  event: {
    event_type: "slack#/events/message_posted",
    channel_ids: ["C05LQKN5F29"], // #slack-invites-approval
    filter: {
      version: 1,
      root: {
        statement: "1 == 1",
      },
    },
  },
  inputs: {
    message_event: {
      value: "{{data}}",
    },
  },
};

export default GuestInviteMessageTrigger;
