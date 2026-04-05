import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const ProcessedInvitesDatastore = DefineDatastore({
  name: "processed_invites",
  primary_key: "message_ts",
  attributes: {
    message_ts: { type: Schema.types.string },
    email: { type: Schema.types.string },
    bot_decision: { type: Schema.types.string },
    jira_issue_key: { type: Schema.types.string },
    status: { type: Schema.types.string }, // "pending" | "decided"
    created_at: { type: Schema.types.string },
  },
});
