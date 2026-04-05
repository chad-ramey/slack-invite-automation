import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ProcessGuestInvite } from "../functions/process_guest_invite.ts";

export const GuestInviteShadowWorkflow = DefineWorkflow({
  callback_id: "guest_invite_shadow_workflow",
  title: "Guest Invite Shadow Mode",
  description:
    "Observe guest invite requests, evaluate rules, and create Jira tickets without taking action",
  input_parameters: {
    properties: {
      message_event: { type: Schema.types.object },
    },
    required: ["message_event"],
  },
});

GuestInviteShadowWorkflow.addStep(ProcessGuestInvite, {
  message_event: GuestInviteShadowWorkflow.inputs.message_event,
});
