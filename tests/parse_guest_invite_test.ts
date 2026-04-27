import { assertEquals } from "@std/assert";
import {
  parseDecisionFromMessage,
  parseDecisionText,
  parseInviteMessage,
  SlackMessage,
} from "../functions/parse_guest_invite.ts";

// === Synthetic test fixtures — no real user data ===

// Test 1: Full request with all fields (Single-Channel Guest, private, time limit, reason)
const fullRequestMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1735831161.641489",
  text: "<@U0EXAMPLE01> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text: "*Email*: <mailto:alice@example.com|alice@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
    },
    { id: 3, text: "*Channel:* :lock: private-channel" },
    {
      id: 4,
      text:
        "*Time limit*: This account will be deactivated on <!date^1736463599^{date} at {time}|June 1st 2020>.",
    },
    { id: 5, text: "*Reason for Request*:\nOnboarding" },
    {
      text:
        ":white_check_mark: <@U0EXAMPLE02> approved this request. Invitation sent.",
    },
  ],
};

// Test 2: Full Member with no channel, no time limit, no reason (denied)
const fullMemberDeniedMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1739527514.899479",
  text: "<@U0EXAMPLE03> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text: "*Email*: <mailto:bob@example.com|bob@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Full Member>",
    },
    { text: ":no_entry_sign: <@U0EXAMPLE04> denied this request." },
  ],
};

// Test 3: Public channel (denied)
const publicChannelMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1739540210.356029",
  text: "<@U0EXAMPLE03> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text: "*Email*: <mailto:bob@example.com|bob@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
    },
    { id: 3, text: "*Channel:* <#C0XXXXXXXXX|random>" },
    { text: ":no_entry_sign: <@U0EXAMPLE04> denied this request." },
  ],
};

// Test 4: Multi-Channel Guest with multiple private channels
const multiChannelGuestMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1761211815.415109",
  text: "<@U0EXAMPLE05> requested to invite one person to YourOrg.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:carol@example.com|carol@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Multi-Channel Guest>",
    },
    { id: 3, text: "*Channels:* :lock: 2 private-channels" },
    {
      id: 4,
      text:
        "*Time limit*: This account will be deactivated on <!date^1772319599^{date} at {time}|June 1st 2020>.",
    },
    {
      text:
        ":white_check_mark: <@U0EXAMPLE06> approved this request. Invitation sent.",
    },
  ],
};

// Test 5: No time limit, no reason (approved anyway)
const noTimeLimitNoReasonMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1736780292.515789",
  text: "<@U0EXAMPLE07> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:dave@example.com|dave@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
    },
    { id: 3, text: "*Channel:* :lock: private-channel" },
    {
      text:
        ":white_check_mark: <@U0EXAMPLE04> approved this request. Invitation sent.",
    },
  ],
};

// Test 6: "Joined the workspace" outcome
const joinedWorkspaceMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1765444611.300049",
  text: "<@U0EXAMPLE08> requested to invite one person to YourOrg.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:frank@example.com|frank@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Full Member>",
    },
    { id: 3, text: "*Channel:* :lock: private-channel" },
    { text: "<@U0EXAMPLE09> joined the workspace." },
  ],
};

// Test 7: Request with reason but no time limit
const reasonNoTimeLimitMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1736339602.734899",
  text: "<@U0EXAMPLE10> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:eve@example.com|eve@example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
    },
    { id: 3, text: "*Channel:* :lock: private-channel" },
    {
      id: 4,
      text:
        "*Reason for Request*:\nExternal hiring agency for hiring purposes",
    },
    {
      text:
        ":white_check_mark: <@U0EXAMPLE04> approved this request. Invitation sent.",
    },
  ],
};

// === parseInviteMessage tests ===

Deno.test("parses full invite with all fields", () => {
  const result = parseInviteMessage(fullRequestMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.requesterUserId, "U0EXAMPLE01");
  assertEquals(result!.email, "alice@example.com");
  assertEquals(result!.accountType, "Single-Channel Guest");
  assertEquals(result!.channelName, "private-channel");
  assertEquals(result!.channelPrivate, true);
  assertEquals(result!.timeLimitEpoch, 1736463599);
  assertEquals(result!.timeLimit !== null, true);
  assertEquals(result!.reason, "Onboarding");
});

Deno.test("parses Full Member invite (no channel, no time limit, no reason)", () => {
  const result = parseInviteMessage(fullMemberDeniedMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.requesterUserId, "U0EXAMPLE03");
  assertEquals(result!.email, "bob@example.com");
  assertEquals(result!.accountType, "Full Member");
  assertEquals(result!.channelName, "unknown"); // no channel attachment
  assertEquals(result!.channelPrivate, false);
  assertEquals(result!.timeLimit, null);
  assertEquals(result!.reason, null);
});

Deno.test("parses public channel with Slack link format", () => {
  const result = parseInviteMessage(publicChannelMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.channelName, "random");
  assertEquals(result!.channelPrivate, false);
});

Deno.test("parses Multi-Channel Guest with multiple private channels", () => {
  const result = parseInviteMessage(multiChannelGuestMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.requesterUserId, "U0EXAMPLE05");
  assertEquals(result!.email, "carol@example.com");
  assertEquals(result!.accountType, "Multi-Channel Guest");
  assertEquals(result!.channelName, "2 private-channels");
  assertEquals(result!.channelPrivate, true);
  assertEquals(result!.timeLimitEpoch, 1772319599);
});

Deno.test("parses invite with no time limit and no reason", () => {
  const result = parseInviteMessage(noTimeLimitNoReasonMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.email, "dave@example.com");
  assertEquals(result!.accountType, "Single-Channel Guest");
  assertEquals(result!.channelPrivate, true);
  assertEquals(result!.timeLimit, null);
  assertEquals(result!.reason, null);
});

Deno.test("parses invite with reason but no time limit", () => {
  const result = parseInviteMessage(reasonNoTimeLimitMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.email, "eve@example.com");
  assertEquals(result!.reason, "External hiring agency for hiring purposes");
  assertEquals(result!.timeLimit, null);
});

Deno.test("parses Full Member with private channel", () => {
  const result = parseInviteMessage(joinedWorkspaceMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.accountType, "Full Member");
  assertEquals(result!.channelName, "private-channel");
  assertEquals(result!.channelPrivate, true);
});

Deno.test("handles 'to this workspace' and 'to YourOrg' variants", () => {
  const result1 = parseInviteMessage(fullRequestMessage); // "to this workspace"
  const result2 = parseInviteMessage(multiChannelGuestMessage); // "to YourOrg"
  assertEquals(result1 !== null, true);
  assertEquals(result2 !== null, true);
});

Deno.test("returns null for non-invite messages", () => {
  assertEquals(
    parseInviteMessage({ text: "Hello, regular message" }),
    null,
  );
  assertEquals(parseInviteMessage({ text: "" }), null);
  assertEquals(parseInviteMessage({}), null);
});

Deno.test("returns null for message with no attachments (text only)", () => {
  const result = parseInviteMessage({
    text: "<@U123> requested to invite one person to this workspace.",
  });
  // No attachments = no email/account type = null
  assertEquals(result, null);
});

// === parseDecisionFromMessage tests ===

Deno.test("parses approval from attachments", () => {
  const result = parseDecisionFromMessage(fullRequestMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.action, "APPROVED");
  assertEquals(result!.actorUserId, "U0EXAMPLE02");
});

Deno.test("parses denial from attachments", () => {
  const result = parseDecisionFromMessage(fullMemberDeniedMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.action, "DENIED");
  assertEquals(result!.actorUserId, "U0EXAMPLE04");
});

Deno.test("parses joined workspace from attachments", () => {
  const result = parseDecisionFromMessage(joinedWorkspaceMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.action, "JOINED");
  assertEquals(result!.actorUserId, "U0EXAMPLE09");
});

Deno.test("returns null for message with no decision", () => {
  const noDecision: SlackMessage = {
    text: "<@U123> requested to invite one person to this workspace.",
    attachments: [
      { text: "*Email*: <mailto:x@y.com|x@y.com>" },
      {
        text:
          "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
      },
    ],
  };
  assertEquals(parseDecisionFromMessage(noDecision), null);
});

// === parseDecisionText tests (unit tests for individual text strings) ===

Deno.test("parseDecisionText: approval", () => {
  const result = parseDecisionText(
    ":white_check_mark: <@U0EXAMPLE04> approved this request. Invitation sent.",
  );
  assertEquals(result !== null, true);
  assertEquals(result!.action, "APPROVED");
  assertEquals(result!.actorUserId, "U0EXAMPLE04");
});

Deno.test("parseDecisionText: denial", () => {
  const result = parseDecisionText(
    ":no_entry_sign: <@U0EXAMPLE04> denied this request.",
  );
  assertEquals(result !== null, true);
  assertEquals(result!.action, "DENIED");
  assertEquals(result!.actorUserId, "U0EXAMPLE04");
});

Deno.test("parseDecisionText: joined", () => {
  const result = parseDecisionText("<@U0EXAMPLE09> joined the workspace.");
  assertEquals(result !== null, true);
  assertEquals(result!.action, "JOINED");
  assertEquals(result!.actorUserId, "U0EXAMPLE09");
});

Deno.test("parseDecisionText: non-decision text", () => {
  assertEquals(parseDecisionText("just a regular message"), null);
  assertEquals(parseDecisionText(""), null);
});

// === inviteRequestId extraction tests ===

Deno.test("parseInviteMessage: extracts inviteRequestId from pending invite with actions", () => {
  const message: SlackMessage = {
    text: "<@U0EXAMPLE12> requested to invite one person to YourOrg.",
    attachments: [
      { id: 1, text: "*Email*: <mailto:test@example.com|test@example.com>" },
      {
        id: 2,
        text:
          "*Account type*: <https://slack.com/help/articles/360018112273|Full Member>",
      },
      { id: 3, text: "*Channel:* :lock: private-channel" },
      {
        id: 4,
        fallback: "Approve/Deny the invite request on team site",
        callback_id: "inviterequests_TYOURTEAMID",
        actions: [
          {
            id: "1",
            name: "approve",
            text: "Send Invitation",
            type: "button",
            value: "10451351706352",
            style: "primary",
          },
          {
            id: "2",
            name: "deny",
            text: "Deny",
            type: "button",
            value: "10451351706352",
            style: "danger",
          },
        ],
      },
    ],
  };

  const result = parseInviteMessage(message);
  assertEquals(result !== null, true);
  assertEquals(result!.inviteRequestId, "10451351706352");
  assertEquals(result!.email, "test@example.com");
  assertEquals(result!.accountType, "Full Member");
});

Deno.test("parseInviteMessage: inviteRequestId is null for already-decided invite", () => {
  const message: SlackMessage = {
    text: "<@U0EXAMPLE11> requested to invite one person to YourOrg.",
    attachments: [
      {
        id: 1,
        text: "*Email*: <mailto:test@gmail.com|test@gmail.com>",
      },
      {
        id: 2,
        text:
          "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
      },
      { id: 3, text: "*Channel:* :lock: private-channel" },
      {
        id: 4,
        text:
          "*Time limit*: This account will be deactivated on <!date^1777499999^{date} at {time}|June 1st 2020>.",
      },
      { id: 5, text: "*Reason for Request*:\nCSA Hiring" },
      {
        text:
          ":white_check_mark: <@U0EXAMPLE06> approved this request. Invitation sent.",
      },
    ],
  };

  const result = parseInviteMessage(message);
  assertEquals(result !== null, true);
  assertEquals(result!.inviteRequestId, null);
  assertEquals(result!.email, "test@gmail.com");
});

Deno.test("parseInviteMessage: inviteRequestId is null when no actions attachment", () => {
  const message: SlackMessage = {
    text: "<@U0EXAMPLE13> requested to invite one person to YourOrg.",
    attachments: [
      {
        id: 1,
        text:
          "*Email*: <mailto:meeting@gmail.com|meeting@gmail.com>",
      },
      {
        id: 2,
        text:
          "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
      },
      { id: 3, text: "*Channel:* :lock: private-channel" },
      { id: 4, text: "*Reason for Request*:\ninterview" },
    ],
  };

  const result = parseInviteMessage(message);
  assertEquals(result !== null, true);
  assertEquals(result!.inviteRequestId, null);
});
