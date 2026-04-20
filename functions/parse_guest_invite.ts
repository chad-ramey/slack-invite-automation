/**
 * Message parser for Slackbot guest invite request messages.
 *
 * Parses the structured attachment-based format posted by Slackbot in
 * #slack-invites-approval. The real Slack format uses:
 * - `text` field: "<@USERID> requested to invite one person to ..."
 * - `attachments[]`: Array of objects, each with a `text` field containing
 *   one piece of data in Slack mrkdwn format (Email, Account type, Channel,
 *   Time limit, Reason, and approval/denial status).
 *
 * This parser handles the attachment-based format from live Events API
 * messages and Slack exports.
 */

// deno-lint-ignore no-explicit-any
type SlackAttachment = Record<string, any>;

// deno-lint-ignore no-explicit-any
export interface SlackMessage extends Record<string, any> {
  text?: string;
  attachments?: SlackAttachment[];
  // deno-lint-ignore no-explicit-any
  blocks?: any[];
  user?: string;
  ts?: string;
}

export interface ParsedGuestInvite {
  requesterUserId: string;
  email: string;
  accountType: string;
  channelName: string;
  channelPrivate: boolean;
  timeLimit: string | null;
  timeLimitEpoch: number | null;
  reason: string | null;
  inviteRequestId: string | null;
}

export interface ParsedDecision {
  action: "APPROVED" | "DENIED" | "JOINED";
  actorUserId: string;
}

/**
 * Parse a Slackbot invite request message into structured data.
 * Returns null if the message doesn't match the expected format.
 *
 * Real Slack format (from attachments):
 *   text: "<@USERID> requested to invite one person to this workspace."
 *   attachments[0].text: "*Email*: <mailto:x@y.com|x@y.com>"
 *   attachments[1].text: "*Account type*: <https://...|Single-Channel Guest>"
 *   attachments[2].text: "*Channel:* :lock: private-channel"
 *   attachments[3].text: "*Time limit*: ...<!date^EPOCH^{date} at {time}|fallback>."
 *   attachments[4].text: "*Reason for Request*:\nreason text"
 *   attachments[N].text: ":white_check_mark: <@UID> approved this request..."
 */
export function parseInviteMessage(
  message: SlackMessage,
): ParsedGuestInvite | null {
  if (!message) return null;

  const text = message.text || "";
  const attachments = message.attachments || [];

  // Validate this is an invite request message
  const requesterMatch = text.match(
    /<@(\w+)>\s+requested to invite/,
  );
  if (!requesterMatch) return null;

  const requesterUserId = requesterMatch[1];

  // Parse structured data from attachments
  let email: string | null = null;
  let accountType: string | null = null;
  let channelName: string | null = null;
  let channelPrivate = false;
  let timeLimit: string | null = null;
  let timeLimitEpoch: number | null = null;
  let reason: string | null = null;
  let inviteRequestId: string | null = null;

  for (const att of attachments) {
    // Invite request ID: found in action buttons (callback_id starts with "inviterequests_")
    if (
      att.callback_id && String(att.callback_id).startsWith("inviterequests_") &&
      Array.isArray(att.actions) && att.actions.length > 0
    ) {
      inviteRequestId = String(att.actions[0].value || "");
      continue;
    }
    const attText = att.text || att.fallback || "";

    // Email: *Email*: <mailto:x@y.com|x@y.com>
    if (attText.includes("*Email*")) {
      const emailMatch = attText.match(
        /\*Email\*:\s*<mailto:([^|]+)\|[^>]+>/,
      );
      if (emailMatch) {
        email = emailMatch[1];
      } else {
        // Fallback: try plain text email
        const plainMatch = attText.match(/\*Email\*:\s*(\S+)/);
        if (plainMatch) email = plainMatch[1];
      }
      continue;
    }

    // Account type: *Account type*: <https://...|Single-Channel Guest>
    if (attText.includes("*Account type*")) {
      const typeMatch = attText.match(/\*Account type\*:\s*<[^|]+\|([^>]+)>/);
      if (typeMatch) {
        accountType = typeMatch[1];
      } else {
        // Fallback: plain text
        const plainMatch = attText.match(/\*Account type\*:\s*(.+)/);
        if (plainMatch) accountType = plainMatch[1].trim();
      }
      continue;
    }

    // Channel(s): *Channel:* :lock: private-channel
    //         or: *Channel:* <#CID|channel-name>
    //         or: *Channels:* :lock: 2 private-channels
    if (/\*Channels?:\*/.test(attText)) {
      // Check for :lock: (private channel indicator)
      channelPrivate = attText.includes(":lock:");

      // Try to extract named public channel: <#CID|name>
      const publicMatch = attText.match(/<#\w+\|([^>]+)>/);
      if (publicMatch) {
        channelName = publicMatch[1];
        channelPrivate = false;
      } else {
        // Private channel - extract the name/description after :lock:
        const privateMatch = attText.match(/:lock:\s+(.+)/);
        if (privateMatch) {
          channelName = privateMatch[1].trim();
        } else {
          // Channel without :lock: and without link
          const channelFallback = attText.match(
            /\*Channels?:\*\s+(.+)/,
          );
          if (channelFallback) {
            channelName = channelFallback[1].trim();
          }
        }
      }
      continue;
    }

    // Time limit: *Time limit*: This account will be deactivated on <!date^EPOCH^{date} at {time}|fallback>.
    if (attText.includes("*Time limit*")) {
      // Extract epoch from <!date^EPOCH^...>
      const epochMatch = attText.match(/<!date\^(\d+)\^/);
      if (epochMatch) {
        timeLimitEpoch = parseInt(epochMatch[1], 10);
        // Convert epoch to human-readable date
        const date = new Date(timeLimitEpoch * 1000);
        timeLimit = date.toISOString();
      }
      // Also try the fallback text
      const fallbackMatch = attText.match(/\|([^>]+)>/);
      if (fallbackMatch && !timeLimit) {
        timeLimit = fallbackMatch[1];
      }
      continue;
    }

    // Reason: *Reason for Request*:\nreason text
    if (attText.includes("*Reason for Request*")) {
      const reasonMatch = attText.match(
        /\*Reason for Request\*:\s*\n?([\s\S]*)/,
      );
      if (reasonMatch) {
        const trimmed = reasonMatch[1].trim();
        reason = trimmed.length > 0 ? trimmed : null;
      }
      continue;
    }
  }

  // Email and account type are required
  if (!email || !accountType) return null;

  return {
    requesterUserId,
    email,
    accountType,
    channelName: channelName || "unknown",
    channelPrivate,
    timeLimit,
    timeLimitEpoch,
    reason,
    inviteRequestId: inviteRequestId || null,
  };
}

/**
 * Parse an approval, denial, or "joined" decision from a Slackbot message's attachments.
 * The decision is appended as an additional attachment when the admin acts.
 *
 * Real formats (in attachment text):
 *   ":white_check_mark: <@UID> approved this request. Invitation sent."
 *   ":no_entry_sign: <@UID> denied this request."
 *   "<@UID> joined the workspace."
 */
export function parseDecisionFromMessage(
  message: SlackMessage,
): ParsedDecision | null {
  if (!message) return null;

  const attachments = message.attachments || [];

  for (const att of attachments) {
    const attText = att.text || att.fallback || "";
    const decision = parseDecisionText(attText);
    if (decision) return decision;
  }

  return null;
}

/**
 * Parse a single attachment text string for a decision.
 * Exported for unit testing convenience.
 */
export function parseDecisionText(text: string): ParsedDecision | null {
  if (!text) return null;

  // Approval: :white_check_mark: <@UID> approved this request. Invitation sent.
  const approvalMatch = text.match(
    /:white_check_mark:\s*<@(\w+)>\s+approved this request/,
  );
  if (approvalMatch) {
    return { action: "APPROVED", actorUserId: approvalMatch[1] };
  }

  // Denial: :no_entry_sign: <@UID> denied this request.
  const denialMatch = text.match(
    /:no_entry_sign:\s*<@(\w+)>\s+denied this request/,
  );
  if (denialMatch) {
    return { action: "DENIED", actorUserId: denialMatch[1] };
  }

  // Joined: <@UID> joined the workspace.
  const joinedMatch = text.match(
    /<@(\w+)>\s+joined the workspace/,
  );
  if (joinedMatch) {
    return { action: "JOINED", actorUserId: joinedMatch[1] };
  }

  return null;
}
