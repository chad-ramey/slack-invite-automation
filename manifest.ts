import { Manifest } from "deno-slack-sdk/mod.ts";
import { PollGuestInvitesWorkflow } from "./workflows/poll_guest_invites_workflow.ts";
import { GuestInviteShadowWorkflow } from "./workflows/guest_invite_shadow_workflow.ts";
import { ProcessedInvitesDatastore } from "./datastores/processed_invites.ts";

export default Manifest({
  name: "EA Slack Invite Automation",
  description:
    "Auto-approves qualifying guest invites, creates Jira audit tickets, flags others for review",
  icon: "assets/ea_slack_connect_auto.png",
  workflows: [PollGuestInvitesWorkflow, GuestInviteShadowWorkflow],
  datastores: [ProcessedInvitesDatastore],
  outgoingDomains: ["your-org.atlassian.net"],
  botScopes: [
    "channels:history",
    "channels:read",
    "chat:write",
    "datastore:read",
    "datastore:write",
    "groups:history",
    "groups:read",
    "users:read",
    "users:read.email",
  ],
});
