/**
 * Scheduled polling function for guest invite shadow mode.
 *
 * Runs every 15 minutes via a scheduled trigger. Fetches recent messages
 * from #slack-invites-approval using conversations.history, then processes
 * new invite requests and detects decisions on pending invites.
 *
 * Uses a Slack Datastore to track processed messages across poll cycles,
 * replacing the in-memory pendingRequests map from the event-driven approach.
 */

import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import {
  parseDecisionFromMessage,
  parseInviteMessage,
  SlackMessage,
} from "./parse_guest_invite.ts";
import { evaluateInviteRules, RuleEvaluation } from "./evaluate_guest_invite.ts";
import {
  createGuestInviteTicket,
  GuestInviteTicketData,
  JiraEnv,
  updateGuestInviteTicket,
} from "./jira_utils.ts";
import { ProcessedInvitesDatastore } from "../datastores/processed_invites.ts";

const DEFAULT_INVITE_CHANNEL = "C05LQKN5F29"; // #slack-invites-approval
const DEFAULT_ALERT_CHANNEL = "C0AN2HL1AG4"; // #ea-slack-admin
const LOOKBACK_HOURS = 48;

// Internal/partner domains to skip entirely — no ticket, no action
const SKIP_DOMAINS = [
  "tripleten.com",
  "nebius.com",
  "internal.yourcompany.com",
  "tavily.com",
];

export const PollGuestInvites = DefineFunction({
  callback_id: "poll_guest_invites",
  title: "Poll Guest Invites (Shadow Mode)",
  description:
    "Periodically poll #slack-invites-approval and process new invite requests",
  source_file: "functions/poll_guest_invites.ts",
  input_parameters: {
    properties: {},
    required: [],
  },
  output_parameters: {
    properties: {
      status: { type: Schema.types.string },
    },
    required: ["status"],
  },
});

export default SlackFunction(
  PollGuestInvites,
  async ({ client, env }) => {
    const shadowModeEnabled = env.SHADOW_MODE_GUEST_INVITES !== "false";
    if (!shadowModeEnabled) {
      console.log("[POLL] Shadow mode disabled, skipping");
      return { outputs: { status: "DISABLED" } };
    }

    const channelId = env.INVITE_CHANNEL_ID || DEFAULT_INVITE_CHANNEL;
    const alertChannelId = env.ALERT_CHANNEL_ID || DEFAULT_ALERT_CHANNEL;
    const jiraEnv: JiraEnv = {
      jiraEmail: env.JIRA_USER_EMAIL || "",
      jiraToken: env.JIRA_API_TOKEN || "",
    };

    const oldest = String(
      Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600,
    );

    console.log(
      `[POLL] Fetching messages from ${channelId} (oldest=${oldest})`,
    );

    // Fetch recent messages from the invite channel
    const historyResult = await client.apiCall("conversations.history", {
      channel: channelId,
      oldest,
      limit: 200,
      inclusive: true,
    });

    if (!historyResult.ok) {
      console.error(
        `[POLL] conversations.history failed: ${historyResult.error}`,
      );
      return { outputs: { status: `ERROR: ${historyResult.error}` } };
    }

    const messages = (historyResult.messages || []) as Array<
      // deno-lint-ignore no-explicit-any
      Record<string, any>
    >;
    console.log(`[POLL] Fetched ${messages.length} messages`);

    let newCount = 0;
    let decidedCount = 0;
    let skippedCount = 0;

    for (const rawMessage of messages) {
      const message = rawMessage as SlackMessage;
      const messageTs = String(message.ts || "");
      if (!messageTs) continue;

      // Check datastore for this message
      const existing = await client.apps.datastore.get({
        datastore: ProcessedInvitesDatastore.name,
        id: messageTs,
      });

      if (existing.ok && existing.item && existing.item.message_ts) {
        // Already tracked
        if (existing.item.status === "decided") {
          skippedCount++;
          continue;
        }

        // Status is "pending" — check if decision has appeared
        const decision = parseDecisionFromMessage(message);
        if (decision && decision.action !== "JOINED") {
          await processDecision(
            messageTs,
            existing.item,
            decision.action,
            decision.actorUserId,
            client,
            jiraEnv,
            alertChannelId,
          );
          decidedCount++;
        } else if (decision && decision.action === "JOINED") {
          // Treat "joined" as implicit approval for comparison
          await processDecision(
            messageTs,
            existing.item,
            "APPROVED",
            decision.actorUserId,
            client,
            jiraEnv,
            alertChannelId,
          );
          decidedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      // New message — parse it
      const invite = parseInviteMessage(message);
      if (!invite) {
        skippedCount++;
        continue;
      }

      console.log(
        `[POLL] New invite: ${invite.email} (${invite.accountType})`,
      );

      // Skip internal/partner domains
      const emailDomain = invite.email.split("@")[1]?.toLowerCase() || "";
      if (SKIP_DOMAINS.includes(emailDomain)) {
        console.log(
          `[POLL] Skipping internal/partner domain: ${emailDomain}`,
        );
        skippedCount++;
        continue;
      }

      const evaluation = evaluateInviteRules(invite);

      // Resolve requester display name
      let requesterName = invite.requesterUserId;
      try {
        const userInfo = await client.apiCall("users.info", {
          user: invite.requesterUserId,
        });
        if (userInfo.ok && userInfo.user) {
          requesterName = userInfo.user.real_name || userInfo.user.name ||
            invite.requesterUserId;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[POLL] Failed to resolve user: ${msg}`);
      }

      // Build ticket data
      const ticketData: GuestInviteTicketData = {
        requesterName,
        requesterUserId: invite.requesterUserId,
        email: invite.email,
        accountType: invite.accountType,
        channelName: invite.channelName,
        channelPrivate: invite.channelPrivate,
        timeLimit: invite.timeLimit,
        reason: invite.reason,
        ruleEvaluation: evaluation,
        humanDecision: "Pending",
        humanDecidedBy: "Pending",
        humanDecidedAt: "Pending",
        processedAt: new Date().toISOString(),
      };

      // Check if decision already present
      const existingDecision = parseDecisionFromMessage(message);

      // Create Jira ticket
      const issueKey = await createGuestInviteTicket(ticketData, jiraEnv);
      if (issueKey) {
        console.log(
          `[POLL] Created Jira ticket ${issueKey} for ${invite.email}`,
        );

        // Reply to the invite message thread with ticket info
        await postThreadReply(
          client,
          channelId,
          messageTs,
          issueKey,
          evaluation,
        );
      } else {
        console.warn(
          `[POLL] Failed to create Jira ticket for ${invite.email}`,
        );
        await postAlert(
          client,
          alertChannelId,
          `Failed to create Jira ticket for guest invite: ${invite.email}`,
        );
      }

      // If decision already present, process it immediately
      if (
        existingDecision &&
        (existingDecision.action === "APPROVED" ||
          existingDecision.action === "DENIED")
      ) {
        const action = existingDecision.action;
        let actorName = existingDecision.actorUserId;
        try {
          const actorInfo = await client.apiCall("users.info", {
            user: existingDecision.actorUserId,
          });
          if (actorInfo.ok && actorInfo.user) {
            actorName = actorInfo.user.real_name || actorInfo.user.name ||
              existingDecision.actorUserId;
          }
        } catch (_err) { /* keep raw ID */ }

        ticketData.humanDecision = action === "APPROVED"
          ? "Approved"
          : "Denied";
        ticketData.humanDecidedBy = actorName;
        ticketData.humanDecidedAt = new Date().toISOString();

        if (issueKey) {
          await updateGuestInviteTicket(issueKey, ticketData, jiraEnv);
        }

        const isMatch = (evaluation.decision === "AUTO_APPROVE" &&
          action === "APPROVED") ||
          (evaluation.decision === "AUTO_DENY" && action === "DENIED");

        if (!isMatch) {
          await postMismatchAlert(
            client,
            alertChannelId,
            ticketData,
            evaluation.decision,
            action,
            actorName,
            issueKey,
          );
        }

        // Store as decided
        await client.apps.datastore.put({
          datastore: ProcessedInvitesDatastore.name,
          item: {
            message_ts: messageTs,
            email: invite.email,
            bot_decision: evaluation.decision,
            jira_issue_key: issueKey || "",
            status: "decided",
            created_at: new Date().toISOString(),
          },
        });
        decidedCount++;
      } else if (existingDecision && existingDecision.action === "JOINED") {
        // Treat "joined" as implicit approval
        const action = "APPROVED" as const;
        ticketData.humanDecision = "Approved";
        ticketData.humanDecidedBy = existingDecision.actorUserId;
        ticketData.humanDecidedAt = new Date().toISOString();

        if (issueKey) {
          await updateGuestInviteTicket(issueKey, ticketData, jiraEnv);
        }

        const isMatch = evaluation.decision === "AUTO_APPROVE";
        if (!isMatch) {
          await postMismatchAlert(
            client,
            alertChannelId,
            ticketData,
            evaluation.decision,
            action,
            existingDecision.actorUserId,
            issueKey,
          );
        }

        await client.apps.datastore.put({
          datastore: ProcessedInvitesDatastore.name,
          item: {
            message_ts: messageTs,
            email: invite.email,
            bot_decision: evaluation.decision,
            jira_issue_key: issueKey || "",
            status: "decided",
            created_at: new Date().toISOString(),
          },
        });
        decidedCount++;
      } else {
        // Store as pending
        await client.apps.datastore.put({
          datastore: ProcessedInvitesDatastore.name,
          item: {
            message_ts: messageTs,
            email: invite.email,
            bot_decision: evaluation.decision,
            jira_issue_key: issueKey || "",
            status: "pending",
            created_at: new Date().toISOString(),
          },
        });
        newCount++;
      }
    }

    const summary =
      `new=${newCount} decided=${decidedCount} skipped=${skippedCount}`;
    console.log(`[POLL] Complete: ${summary}`);

    return { outputs: { status: summary } };
  },
);

/**
 * Process a decision for a previously pending invite.
 */
async function processDecision(
  messageTs: string,
  // deno-lint-ignore no-explicit-any
  datastoreItem: Record<string, any>,
  action: "APPROVED" | "DENIED",
  actorUserId: string,
  // deno-lint-ignore no-explicit-any
  client: any,
  jiraEnv: JiraEnv,
  alertChannelId: string,
): Promise<void> {
  const email = datastoreItem.email || "unknown";
  const botDecision = datastoreItem.bot_decision || "UNKNOWN";
  const jiraIssueKey = datastoreItem.jira_issue_key || "";

  console.log(
    `[POLL] Decision detected for ${email}: ${action} by ${actorUserId}`,
  );

  // Resolve actor name
  let actorName = actorUserId;
  try {
    const userInfo = await client.apiCall("users.info", { user: actorUserId });
    if (userInfo.ok && userInfo.user) {
      actorName = userInfo.user.real_name || userInfo.user.name || actorUserId;
    }
  } catch (_err) { /* keep raw ID */ }

  // Update Jira ticket if we have one
  if (jiraIssueKey) {
    // We need to reconstruct minimal ticket data for the update
    const humanDecision = action === "APPROVED" ? "Approved" : "Denied";
    // Re-fetch won't have the full invite data, but we can update with what we know
    // The updateGuestInviteTicket rebuilds the full description from ticketData
    // For now, post a comment-style update via the existing function
    // We need the full GuestInviteTicketData — build a minimal version
    const ticketData: GuestInviteTicketData = {
      requesterName: "See original ticket",
      requesterUserId: "",
      email,
      accountType: "",
      channelName: "",
      channelPrivate: false,
      timeLimit: null,
      reason: null,
      ruleEvaluation: {
        accountType: { value: "", pass: false },
        channelPrivate: { value: false, pass: false },
        timeLimitSet: { value: false, pass: false },
        reasonProvided: { value: false, pass: false },
        decision: botDecision as "AUTO_APPROVE" | "AUTO_DENY" | "MANUAL_REVIEW",
      },
      humanDecision,
      humanDecidedBy: actorName,
      humanDecidedAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
    };

    await updateGuestInviteTicket(jiraIssueKey, ticketData, jiraEnv);
  }

  // Check for mismatch
  const isMatch = (botDecision === "AUTO_APPROVE" && action === "APPROVED") ||
    (botDecision === "AUTO_DENY" && action === "DENIED");

  if (!isMatch) {
    await postMismatchAlert(
      client,
      alertChannelId,
      { email } as GuestInviteTicketData,
      botDecision,
      action,
      actorName,
      jiraIssueKey,
    );
  }

  // Update datastore status to decided
  await client.apps.datastore.put({
    datastore: ProcessedInvitesDatastore.name,
    item: {
      message_ts: messageTs,
      email,
      bot_decision: botDecision,
      jira_issue_key: jiraIssueKey,
      status: "decided",
      created_at: datastoreItem.created_at || new Date().toISOString(),
    },
  });
}

async function postThreadReply(
  // deno-lint-ignore no-explicit-any
  client: any,
  channelId: string,
  threadTs: string,
  issueKey: string,
  evaluation: RuleEvaluation,
): Promise<void> {
  const jiraUrl = `https://your-org.atlassian.net/browse/${issueKey}`;

  // Polling path is always shadow-only (never approves)
  let text: string;
  if (evaluation.decision === "AUTO_DENY") {
    text =
      `:no_entry_sign: *Flagged* | <${jiraUrl}|${issueKey}> | Full Member — requires manual review`;
  } else if (evaluation.decision === "MANUAL_REVIEW") {
    text =
      `:eyes: *Manual Review* | <${jiraUrl}|${issueKey}> | Missing criteria — needs admin review`;
  } else {
    text =
      `:white_check_mark: *Shadow* | <${jiraUrl}|${issueKey}> | Bot decision: *${evaluation.decision}*`;
  }

  try {
    const result = await client.apiCall("chat.postMessage", {
      channel: channelId,
      thread_ts: threadTs,
      text,
    });
    if (result.ok) {
      console.log(`[POLL] Thread reply posted for ${issueKey}`);
    } else {
      console.error(`[POLL] Failed to post thread reply: ${result.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[POLL] Exception posting thread reply: ${msg}`);
  }
}

async function postMismatchAlert(
  // deno-lint-ignore no-explicit-any
  client: any,
  channelId: string,
  ticketData: GuestInviteTicketData,
  botDecision: string,
  humanAction: string,
  actorName: string,
  jiraIssueKey: string | null,
): Promise<void> {
  const text = `:warning: *Guest Invite Shadow Mode - MISMATCH*\n\n` +
    `*Email:* ${ticketData.email}\n` +
    `*Bot would have:* ${botDecision}\n` +
    `*Human decided:* ${humanAction} (by ${actorName})\n` +
    `*Jira:* ${jiraIssueKey || "no ticket"}\n\n` +
    `_Review the evaluation rules for this case._`;

  await postAlert(client, channelId, text);
}

async function postAlert(
  // deno-lint-ignore no-explicit-any
  client: any,
  channelId: string,
  alertText: string,
): Promise<void> {
  try {
    const postResult = await client.apiCall("chat.postMessage", {
      channel: channelId,
      text: alertText,
    });

    if (postResult.ok) {
      console.log(`[ALERT] Posted alert to ${channelId}`);
    } else {
      console.error(`[ALERT] Failed to post alert: ${postResult.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ALERT] Exception posting alert: ${msg}`);
  }
}
