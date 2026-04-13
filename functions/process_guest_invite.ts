/**
 * Main shadow mode function for guest invite requests.
 *
 * Processes message events from #slack-invites-approval:
 * 1. New invite request messages: parse attachments, evaluate rules, create Jira ticket
 * 2. Updated messages (message_changed): detect approval/denial, update Jira ticket
 *
 * Shadow mode: observe and log only. NO approval/denial actions are taken.
 *
 * State is persisted in the ProcessedInvitesDatastore (keyed by message_ts)
 * to survive across function invocations and handle double-fire dedup.
 */

import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import {
  parseDecisionFromMessage,
  parseInviteMessage,
  SlackMessage,
} from "./parse_guest_invite.ts";
import {
  evaluateInviteRules,
  RuleEvaluation,
} from "./evaluate_guest_invite.ts";
import {
  createGuestInviteTicket,
  GuestInviteTicketData,
  JiraEnv,
  updateGuestInviteTicket,
} from "./jira_utils.ts";
import { ProcessedInvitesDatastore } from "../datastores/processed_invites.ts";

// Default alert channel: #ea-slack-admin. Override via ALERT_CHANNEL_ID env var.
const DEFAULT_ALERT_CHANNEL = "C0AN2HL1AG4";

// Internal/partner domains to skip entirely — no ticket, no action
const SKIP_DOMAINS = [
  "tripleten.com",
  "nebius.com",
  "internal.yourcompany.com",
  "tavily.com",
];

export const ProcessGuestInvite = DefineFunction({
  callback_id: "process_guest_invite",
  title: "Process Guest Invite (Shadow Mode)",
  description:
    "Parse guest invite messages, evaluate rules, and create Jira tickets without taking action",
  source_file: "functions/process_guest_invite.ts",
  input_parameters: {
    properties: {
      message_event: { type: Schema.types.object },
    },
    required: ["message_event"],
  },
  output_parameters: {
    properties: {
      status: { type: Schema.types.string },
      error: { type: Schema.types.string },
    },
    required: ["status"],
  },
});

export default SlackFunction(
  ProcessGuestInvite,
  async ({ inputs, client, env }) => {
    // Check shadow mode toggle
    const shadowModeEnabled = env.SHADOW_MODE_GUEST_INVITES !== "false";
    if (!shadowModeEnabled) {
      console.log("[SHADOW] Shadow mode disabled, skipping");
      return { outputs: { status: "DISABLED", error: "" } };
    }

    const event = inputs.message_event as Record<string, unknown>;
    const subtype = String(event.subtype || "");

    console.log(
      `[SHADOW] Processing message event, subtype: ${subtype || "(none)"}`,
    );

    const jiraEnv: JiraEnv = {
      jiraEmail: env.JIRA_USER_EMAIL || "",
      jiraToken: env.JIRA_API_TOKEN || "",
    };

    const alertChannelId = env.ALERT_CHANNEL_ID || DEFAULT_ALERT_CHANNEL;

    try {
      if (subtype === "message_changed") {
        return await handleMessageChanged(
          event,
          client,
          jiraEnv,
          alertChannelId,
        );
      } else if (!subtype || subtype === "bot_message") {
        // message_posted events don't include attachments — only attachments_text.
        // If the text matches the invite pattern, fetch the full message via
        // conversations.history to get the structured attachment data the parser needs.
        let message = event as SlackMessage;
        const eventText = String(event.text || "");
        const looksLikeInvite = /requested to invite/.test(eventText);

        if (looksLikeInvite && !Array.isArray(event.attachments)) {
          const channelId = String(
            event.channel_id || event.channel || "",
          );
          const messageTs = String(event.message_ts || event.ts || "");

          if (channelId && messageTs) {
            console.log(
              `[SHADOW] Fetching full message via conversations.history (channel=${channelId}, ts=${messageTs})`,
            );
            const historyResult = await client.conversations.history({
              channel: channelId,
              latest: messageTs,
              oldest: messageTs,
              inclusive: true,
              limit: 1,
            });

            if (historyResult.ok && historyResult.messages?.length > 0) {
              message = historyResult.messages[0] as SlackMessage;
              console.log(
                `[SHADOW] Got full message, attachments: ${
                  Array.isArray(message.attachments)
                    ? message.attachments.length
                    : 0
                }`,
              );
            } else {
              console.error(
                `[SHADOW] Failed to fetch full message: ${
                  historyResult.error || "no messages returned"
                }`,
              );
            }
          }
        }

        return await handleNewMessage(
          message,
          client,
          jiraEnv,
          alertChannelId,
          env.SLACK_ADMIN_USER_TOKEN || "",
        );
      } else {
        console.log(`[SHADOW] Ignoring message subtype: ${subtype}`);
        return {
          outputs: { status: `IGNORED: subtype ${subtype}`, error: "" },
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SHADOW] Unhandled exception: ${msg}`);
      await postAlert(client, alertChannelId, `Shadow mode exception: ${msg}`);
      return { outputs: { status: "ERROR", error: msg } };
    }
  },
);

async function handleNewMessage(
  message: SlackMessage,
  // deno-lint-ignore no-explicit-any
  client: any,
  jiraEnv: JiraEnv,
  alertChannelId: string,
  adminToken: string,
): Promise<{ outputs: { status: string; error: string } }> {
  const messageTs = String(message.ts || "");

  // Dedup check — if already in datastore, skip (handles double-fire)
  const existing = await client.apps.datastore.get({
    datastore: ProcessedInvitesDatastore.name,
    id: messageTs,
  });
  if (existing.ok && existing.item && existing.item.message_ts) {
    console.log(
      `[SHADOW] Already processed ts=${messageTs} (status=${existing.item.status}), skipping`,
    );
    return {
      outputs: {
        status: `DEDUP: already tracked as ${existing.item.status}`,
        error: "",
      },
    };
  }

  // Parse the structured attachments for invite request data
  const invite = parseInviteMessage(message);
  if (!invite) {
    console.log("[SHADOW] Message does not match invite format, skipping");
    return {
      outputs: { status: "SKIPPED: not an invite message", error: "" },
    };
  }

  console.log(
    `[SHADOW] Parsed invite request: ${invite.email} (${invite.accountType})`,
  );

  // Skip internal/partner domains
  const emailDomain = invite.email.split("@")[1]?.toLowerCase() || "";
  if (SKIP_DOMAINS.includes(emailDomain)) {
    console.log(
      `[SHADOW] Skipping internal/partner domain: ${emailDomain}`,
    );
    return {
      outputs: {
        status: `SKIPPED: internal domain ${emailDomain}`,
        error: "",
      },
    };
  }

  // Evaluate rules
  const evaluation = evaluateInviteRules(invite);
  console.log(
    `[SHADOW] Rule evaluation: ${JSON.stringify(evaluation)}`,
  );

  // Resolve requester display name from user ID
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
    console.warn(`[SHADOW] Failed to resolve user: ${msg}`);
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

  // Check if there's already a decision in the attachments
  const existingDecision = parseDecisionFromMessage(message);

  // Auto-approve if all criteria met and invite is still pending
  let autoApproved = false;
  if (
    evaluation.decision === "AUTO_APPROVE" && invite.inviteRequestId &&
    adminToken
  ) {
    console.log(
      `[LIVE] Auto-approving invite ${invite.inviteRequestId} for ${invite.email}`,
    );
    try {
      const formBody = new URLSearchParams();
      formBody.append("invite_request_id", invite.inviteRequestId);
      formBody.append("team_id", "T056MAJRM63");

      const approveResponse = await fetch(
        "https://slack.com/api/admin.inviteRequests.approve",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${adminToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody.toString(),
        },
      );
      const approveResult = await approveResponse.json();
      if (approveResult.ok) {
        autoApproved = true;
        console.log(
          `[LIVE] Successfully approved invite for ${invite.email}`,
        );
      } else {
        console.error(
          `[LIVE] Failed to approve invite: ${approveResult.error}`,
        );
        await postAlert(
          client,
          alertChannelId,
          `:warning: Failed to auto-approve guest invite for ${invite.email}: ${approveResult.error}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LIVE] Exception approving invite: ${msg}`);
      await postAlert(
        client,
        alertChannelId,
        `:warning: Exception auto-approving guest invite for ${invite.email}: ${msg}`,
      );
    }
  } else if (
    evaluation.decision === "AUTO_APPROVE" && invite.inviteRequestId &&
    !adminToken
  ) {
    console.warn(
      `[LIVE] SLACK_ADMIN_USER_TOKEN not set — cannot auto-approve ${invite.email}`,
    );
  }

  // Create Jira ticket
  const issueKey = await createGuestInviteTicket(ticketData, jiraEnv);
  if (issueKey) {
    console.log(
      `[SHADOW] Created Jira ticket ${issueKey} for ${invite.email}`,
    );

    // Reply to the invite message thread with ticket info
    const channelId = String(message.channel || message.channel_id || "");
    if (channelId && messageTs) {
      await postThreadReply(
        client,
        channelId,
        messageTs,
        issueKey,
        evaluation,
        autoApproved,
      );
    }
  } else {
    console.warn(`[SHADOW] Failed to create Jira ticket for ${invite.email}`);
    await postAlert(
      client,
      alertChannelId,
      `Failed to create Jira ticket for guest invite: ${invite.email}`,
    );
  }

  // If decision already present, process it immediately and store as decided
  if (existingDecision && existingDecision.action !== "JOINED") {
    const action = existingDecision.action;
    return await processDecisionAndStore(
      messageTs,
      invite.email,
      evaluation,
      issueKey,
      ticketData,
      action,
      existingDecision.actorUserId,
      client,
      jiraEnv,
      alertChannelId,
    );
  }

  if (existingDecision && existingDecision.action === "JOINED") {
    return await processDecisionAndStore(
      messageTs,
      invite.email,
      evaluation,
      issueKey,
      ticketData,
      "APPROVED",
      existingDecision.actorUserId,
      client,
      jiraEnv,
      alertChannelId,
    );
  }

  // Store as pending in datastore
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

  console.log(
    `[SHADOW] Stored pending request for ts=${messageTs}, decision=${evaluation.decision}`,
  );

  return {
    outputs: {
      status: `PROCESSED: ${invite.email} -> ${evaluation.decision} (${
        issueKey || "no ticket"
      })`,
      error: "",
    },
  };
}

async function handleMessageChanged(
  event: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  client: any,
  jiraEnv: JiraEnv,
  alertChannelId: string,
): Promise<{ outputs: { status: string; error: string } }> {
  const message = event.message as SlackMessage | undefined;
  if (!message) {
    console.log("[SHADOW] message_changed with no message field, skipping");
    return { outputs: { status: "SKIPPED: no message in event", error: "" } };
  }

  const messageTs = String(message.ts || "");

  // Check datastore for this message
  const existing = await client.apps.datastore.get({
    datastore: ProcessedInvitesDatastore.name,
    id: messageTs,
  });
  const tracked = existing.ok && existing.item && existing.item.message_ts;

  // If already decided, skip (dedup for double-fire of message_changed)
  if (tracked && existing.item.status === "decided") {
    console.log(
      `[SHADOW] Already decided ts=${messageTs}, skipping`,
    );
    return {
      outputs: { status: `DEDUP: already decided`, error: "" },
    };
  }

  // Check for a decision in the updated message's attachments
  const decision = parseDecisionFromMessage(message);

  if (!decision) {
    // No decision yet — might be a new invite we haven't seen
    if (!tracked) {
      const invite = parseInviteMessage(message);
      if (invite) {
        console.log(
          `[SHADOW] Found new invite in message_changed for ts=${messageTs}`,
        );
        return await handleNewMessage(
          { ...message, ts: messageTs },
          client,
          jiraEnv,
          alertChannelId,
          "", // No admin token for message_changed path — shadow only
        );
      }
    }

    console.log(
      "[SHADOW] message_changed does not contain a decision, skipping",
    );
    return {
      outputs: {
        status: "SKIPPED: no decision in updated message",
        error: "",
      },
    };
  }

  // Normalize "JOINED" to "APPROVED"
  const action = decision.action === "JOINED" ? "APPROVED" : decision.action;
  if (decision.action === "JOINED") {
    console.log(
      `[SHADOW] User joined workspace (ts=${messageTs}), treating as implicit approval`,
    );
  }

  // If we have this tracked as pending, process the decision
  if (tracked && existing.item.status === "pending") {
    return await processDecisionFromDatastore(
      messageTs,
      existing.item,
      action as "APPROVED" | "DENIED",
      decision.actorUserId,
      client,
      jiraEnv,
      alertChannelId,
    );
  }

  // Not tracked at all — parse, create ticket, then process decision
  return await processDecisionFromChanged(
    message,
    messageTs,
    action as "APPROVED" | "DENIED",
    decision.actorUserId,
    client,
    jiraEnv,
    alertChannelId,
  );
}

/**
 * Process a decision for a message already tracked as "pending" in the datastore.
 * Reads stored bot_decision and jira_issue_key to avoid re-parsing.
 */
async function processDecisionFromDatastore(
  messageTs: string,
  // deno-lint-ignore no-explicit-any
  datastoreItem: Record<string, any>,
  action: "APPROVED" | "DENIED",
  actorUserId: string,
  // deno-lint-ignore no-explicit-any
  client: any,
  jiraEnv: JiraEnv,
  alertChannelId: string,
): Promise<{ outputs: { status: string; error: string } }> {
  console.log(
    `[SHADOW] Processing decision from datastore: ${action} by ${actorUserId}`,
  );

  // Resolve actor display name
  let actorName = actorUserId;
  try {
    const userInfo = await client.apiCall("users.info", {
      user: actorUserId,
    });
    if (userInfo.ok && userInfo.user) {
      actorName = userInfo.user.real_name || userInfo.user.name || actorUserId;
    }
  } catch (_err) {
    // Keep the raw ID
  }

  const botDecision = String(datastoreItem.bot_decision || "");
  const jiraIssueKey = String(datastoreItem.jira_issue_key || "");
  const email = String(datastoreItem.email || "");

  // Update Jira ticket if we have one
  if (jiraIssueKey) {
    const humanDecision = action === "APPROVED" ? "Approved" : "Denied";
    const ticketData: GuestInviteTicketData = {
      requesterName: "",
      requesterUserId: "",
      email,
      accountType: "",
      channelName: "",
      channelPrivate: false,
      timeLimit: null,
      reason: "",
      ruleEvaluation: { decision: botDecision } as RuleEvaluation,
      humanDecision,
      humanDecidedBy: actorName,
      humanDecidedAt: new Date().toISOString(),
      processedAt: datastoreItem.created_at || new Date().toISOString(),
    };

    await updateGuestInviteTicket(jiraIssueKey, ticketData, jiraEnv);
  }

  // Check match and alert on mismatch
  const isMatch = (botDecision === "AUTO_APPROVE" && action === "APPROVED") ||
    (botDecision === "AUTO_DENY" && action === "DENIED");

  console.log(
    `[SHADOW] Comparison: email=${email} bot=${botDecision} human=${action} match=${isMatch}`,
  );

  if (!isMatch) {
    const mismatchText = `:warning: *Guest Invite Shadow Mode - MISMATCH*\n\n` +
      `*Email:* ${email}\n` +
      `*Bot would have:* ${botDecision}\n` +
      `*Human decided:* ${action} (by ${actorName})\n` +
      `*Jira:* ${jiraIssueKey || "no ticket"}\n\n` +
      `_Review the evaluation rules for this case._`;

    await postAlert(client, alertChannelId, mismatchText);
    console.log(`[SHADOW] Posted mismatch alert for ${email}`);
  } else {
    console.log(`[SHADOW] Decision match for ${email} — no alert needed`);
  }

  // Update datastore to decided
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

  return {
    outputs: {
      status:
        `COMPARED: ${email} -> bot=${botDecision} human=${action} match=${isMatch}`,
      error: "",
    },
  };
}

/**
 * Process a decision for a message NOT yet in the datastore.
 * Parses the full message, creates a Jira ticket, then processes the decision.
 */
async function processDecisionFromChanged(
  message: SlackMessage,
  messageTs: string,
  action: "APPROVED" | "DENIED",
  actorUserId: string,
  // deno-lint-ignore no-explicit-any
  client: any,
  jiraEnv: JiraEnv,
  alertChannelId: string,
): Promise<{ outputs: { status: string; error: string } }> {
  // Dedup check again (in case double-fire of message_changed)
  const existing = await client.apps.datastore.get({
    datastore: ProcessedInvitesDatastore.name,
    id: messageTs,
  });
  if (existing.ok && existing.item && existing.item.message_ts) {
    if (existing.item.status === "decided") {
      return { outputs: { status: "DEDUP: already decided", error: "" } };
    }
    // Now tracked as pending — use the datastore path
    return await processDecisionFromDatastore(
      messageTs,
      existing.item,
      action,
      actorUserId,
      client,
      jiraEnv,
      alertChannelId,
    );
  }

  console.log(
    `[SHADOW] No pending request for ts=${messageTs}, parsing full message`,
  );
  const invite = parseInviteMessage(message);
  if (!invite) {
    console.warn("[SHADOW] Could not parse invite from message_changed");
    return {
      outputs: {
        status: "SKIPPED: decision found but could not parse original invite",
        error: "",
      },
    };
  }

  const evaluation = evaluateInviteRules(invite);
  const ticketData: GuestInviteTicketData = {
    requesterName: invite.requesterUserId,
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

  const issueKey = await createGuestInviteTicket(ticketData, jiraEnv);

  return await processDecisionAndStore(
    messageTs,
    invite.email,
    evaluation,
    issueKey,
    ticketData,
    action,
    actorUserId,
    client,
    jiraEnv,
    alertChannelId,
  );
}

/**
 * Process a decision and store the result as "decided" in the datastore.
 * Used when we have the full ticket data (either from handleNewMessage or processDecisionFromChanged).
 */
async function processDecisionAndStore(
  messageTs: string,
  email: string,
  evaluation: RuleEvaluation,
  issueKey: string | null,
  ticketData: GuestInviteTicketData,
  action: "APPROVED" | "DENIED",
  actorUserId: string,
  // deno-lint-ignore no-explicit-any
  client: any,
  jiraEnv: JiraEnv,
  alertChannelId: string,
): Promise<{ outputs: { status: string; error: string } }> {
  console.log(
    `[SHADOW] Processing decision: ${action} by ${actorUserId}`,
  );

  // Resolve actor display name
  let actorName = actorUserId;
  try {
    const userInfo = await client.apiCall("users.info", {
      user: actorUserId,
    });
    if (userInfo.ok && userInfo.user) {
      actorName = userInfo.user.real_name || userInfo.user.name || actorUserId;
    }
  } catch (_err) {
    // Keep the raw ID
  }

  // Update ticket data with decision
  const humanDecision = action === "APPROVED" ? "Approved" : "Denied";
  ticketData.humanDecision = humanDecision;
  ticketData.humanDecidedBy = actorName;
  ticketData.humanDecidedAt = new Date().toISOString();

  // Calculate match
  const botDecision = evaluation.decision;
  const isMatch = (botDecision === "AUTO_APPROVE" && action === "APPROVED") ||
    (botDecision === "AUTO_DENY" && action === "DENIED");

  console.log(
    `[SHADOW] Comparison: email=${email} bot=${botDecision} human=${action} match=${isMatch}`,
  );

  // Update Jira ticket if we have one
  if (issueKey) {
    await updateGuestInviteTicket(issueKey, ticketData, jiraEnv);
  }

  // Post alert on mismatch only
  if (!isMatch) {
    const mismatchText = `:warning: *Guest Invite Shadow Mode - MISMATCH*\n\n` +
      `*Email:* ${email}\n` +
      `*Bot would have:* ${botDecision}\n` +
      `*Human decided:* ${action} (by ${actorName})\n` +
      `*Account Type:* ${ticketData.accountType}\n` +
      `*Channel:* ${ticketData.channelName}\n` +
      `*Jira:* ${issueKey || "no ticket"}\n\n` +
      `_Review the evaluation rules for this case._`;

    await postAlert(client, alertChannelId, mismatchText);
    console.log(`[SHADOW] Posted mismatch alert for ${email}`);
  } else {
    console.log(`[SHADOW] Decision match for ${email} — no alert needed`);
  }

  // Store as decided in datastore
  await client.apps.datastore.put({
    datastore: ProcessedInvitesDatastore.name,
    item: {
      message_ts: messageTs,
      email,
      bot_decision: botDecision,
      jira_issue_key: issueKey || "",
      status: "decided",
      created_at: new Date().toISOString(),
    },
  });

  return {
    outputs: {
      status:
        `COMPARED: ${email} -> bot=${botDecision} human=${action} match=${isMatch}`,
      error: "",
    },
  };
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
      console.error(
        `[ALERT] Failed to post alert: ${postResult.error}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ALERT] Exception posting alert: ${msg}`);
  }
}

async function postThreadReply(
  // deno-lint-ignore no-explicit-any
  client: any,
  channelId: string,
  threadTs: string,
  issueKey: string,
  evaluation: RuleEvaluation,
  autoApproved = false,
): Promise<void> {
  const jiraUrl = `https://your-org.atlassian.net/browse/${issueKey}`;

  let text: string;
  if (autoApproved) {
    text =
      `:white_check_mark: *Auto-Approved* | <${jiraUrl}|${issueKey}> | Approved by EA Slack Invite Automation`;
  } else if (evaluation.decision === "AUTO_DENY") {
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
      console.log(`[SHADOW] Thread reply posted for ${issueKey}`);
    } else {
      console.error(`[SHADOW] Failed to post thread reply: ${result.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SHADOW] Exception posting thread reply: ${msg}`);
  }
}
