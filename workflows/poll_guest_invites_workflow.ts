import { DefineWorkflow } from "deno-slack-sdk/mod.ts";
import { PollGuestInvites } from "../functions/poll_guest_invites.ts";

export const PollGuestInvitesWorkflow = DefineWorkflow({
  callback_id: "poll_guest_invites_workflow",
  title: "Poll Guest Invites (Shadow Mode)",
  description:
    "Scheduled workflow that polls #slack-invites-approval for new invite requests",
  input_parameters: {
    properties: {},
    required: [],
  },
});

PollGuestInvitesWorkflow.addStep(PollGuestInvites, {});
