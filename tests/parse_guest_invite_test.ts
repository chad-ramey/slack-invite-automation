import { assertEquals } from "@std/assert";
import {
  parseDecisionFromMessage,
  parseDecisionText,
  parseInviteMessage,
  SlackMessage,
} from "../functions/parse_guest_invite.ts";

// === Real Slack export data used as test fixtures ===

// Test 1: Full request with all fields (Single-Channel Guest, private, time limit, reason)
const fullRequestMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1735831161.641489",
  text: "<@U05B5JXG5K5> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text: "*Email*: <mailto:D.snellink@gmail.com|D.snellink@gmail.com>",
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
        ":white_check_mark: <@U05ATV3ARPB> approved this request. Invitation sent.",
    },
  ],
};

// Test 2: Full Member with no channel, no time limit, no reason (denied)
const fullMemberDeniedMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1739527514.899479",
  text: "<@U05FCG7DGGH> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text: "*Email*: <mailto:homalali@toloka.ai|homalali@toloka.ai>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Full Member>",
    },
    { text: ":no_entry_sign: <@U06DJER921F> denied this request." },
  ],
};

// Test 3: Public channel (denied)
const publicChannelMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1739540210.356029",
  text: "<@U05FCG7DGGH> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text: "*Email*: <mailto:homalali@toloka.ai|homalali@toloka.ai>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
    },
    { id: 3, text: "*Channel:* <#C0571SPM8SE|random>" },
    { text: ":no_entry_sign: <@U06DJER921F> denied this request." },
  ],
};

// Test 4: Multi-Channel Guest with multiple private channels
const multiChannelGuestMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1761211815.415109",
  text: "<@U063X2PS58X> requested to invite one person to Nebius.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:Jawid.Barez@protiviti.nl|Jawid.Barez@protiviti.nl>",
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
        ":white_check_mark: <@U083F1R4Z5J> approved this request. Invitation sent.",
    },
  ],
};

// Test 5: No time limit, no reason (approved anyway)
const noTimeLimitNoReasonMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1736780292.515789",
  text: "<@U06CZ6PNH3Q> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:pradeeppicassop@gmail.com|pradeeppicassop@gmail.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Single-Channel Guest>",
    },
    { id: 3, text: "*Channel:* :lock: private-channel" },
    {
      text:
        ":white_check_mark: <@U06DJER921F> approved this request. Invitation sent.",
    },
  ],
};

// Test 6: "Joined the workspace" outcome
const joinedWorkspaceMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1765444611.300049",
  text: "<@U05DVKKM3KJ> requested to invite one person to Nebius.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:shyrell123@former.example.com|shyrell123@former.example.com>",
    },
    {
      id: 2,
      text:
        "*Account type*: <https://slack.com/help/articles/360018112273|Full Member>",
    },
    { id: 3, text: "*Channel:* :lock: private-channel" },
    { text: "<@U0A34QW6KUZ> joined the workspace." },
  ],
};

// Test 7: Request with reason but no time limit
const reasonNoTimeLimitMessage: SlackMessage = {
  user: "USLACKBOT",
  type: "message",
  ts: "1736339602.734899",
  text: "<@U05B860QXL4> requested to invite one person to this workspace.",
  attachments: [
    {
      id: 1,
      text:
        "*Email*: <mailto:bpatel@realmgroup.io|bpatel@realmgroup.io>",
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
        ":white_check_mark: <@U06DJER921F> approved this request. Invitation sent.",
    },
  ],
};

// === parseInviteMessage tests ===

Deno.test("parses full invite with all fields", () => {
  const result = parseInviteMessage(fullRequestMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.requesterUserId, "U05B5JXG5K5");
  assertEquals(result!.email, "D.snellink@gmail.com");
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
  assertEquals(result!.requesterUserId, "U05FCG7DGGH");
  assertEquals(result!.email, "homalali@toloka.ai");
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
  assertEquals(result!.requesterUserId, "U063X2PS58X");
  assertEquals(result!.email, "Jawid.Barez@protiviti.nl");
  assertEquals(result!.accountType, "Multi-Channel Guest");
  assertEquals(result!.channelName, "2 private-channels");
  assertEquals(result!.channelPrivate, true);
  assertEquals(result!.timeLimitEpoch, 1772319599);
});

Deno.test("parses invite with no time limit and no reason", () => {
  const result = parseInviteMessage(noTimeLimitNoReasonMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.email, "pradeeppicassop@gmail.com");
  assertEquals(result!.accountType, "Single-Channel Guest");
  assertEquals(result!.channelPrivate, true);
  assertEquals(result!.timeLimit, null);
  assertEquals(result!.reason, null);
});

Deno.test("parses invite with reason but no time limit", () => {
  const result = parseInviteMessage(reasonNoTimeLimitMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.email, "bpatel@realmgroup.io");
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

Deno.test("handles 'to this workspace' and 'to Nebius' variants", () => {
  const result1 = parseInviteMessage(fullRequestMessage); // "to this workspace"
  const result2 = parseInviteMessage(multiChannelGuestMessage); // "to Nebius"
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
  assertEquals(result!.actorUserId, "U05ATV3ARPB");
});

Deno.test("parses denial from attachments", () => {
  const result = parseDecisionFromMessage(fullMemberDeniedMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.action, "DENIED");
  assertEquals(result!.actorUserId, "U06DJER921F");
});

Deno.test("parses joined workspace from attachments", () => {
  const result = parseDecisionFromMessage(joinedWorkspaceMessage);
  assertEquals(result !== null, true);
  assertEquals(result!.action, "JOINED");
  assertEquals(result!.actorUserId, "U0A34QW6KUZ");
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
    ":white_check_mark: <@U06DJER921F> approved this request. Invitation sent.",
  );
  assertEquals(result !== null, true);
  assertEquals(result!.action, "APPROVED");
  assertEquals(result!.actorUserId, "U06DJER921F");
});

Deno.test("parseDecisionText: denial", () => {
  const result = parseDecisionText(
    ":no_entry_sign: <@U06DJER921F> denied this request.",
  );
  assertEquals(result !== null, true);
  assertEquals(result!.action, "DENIED");
  assertEquals(result!.actorUserId, "U06DJER921F");
});

Deno.test("parseDecisionText: joined", () => {
  const result = parseDecisionText("<@U0A34QW6KUZ> joined the workspace.");
  assertEquals(result !== null, true);
  assertEquals(result!.action, "JOINED");
  assertEquals(result!.actorUserId, "U0A34QW6KUZ");
});

Deno.test("parseDecisionText: non-decision text", () => {
  assertEquals(parseDecisionText("just a regular message"), null);
  assertEquals(parseDecisionText(""), null);
});

// === inviteRequestId extraction tests ===

Deno.test("parseInviteMessage: extracts inviteRequestId from pending invite with actions", () => {
  const message: SlackMessage = {
    text: "<@U0A9LLN7CN9> requested to invite one person to Nebius.",
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
    text: "<@U05RFQEE5LY> requested to invite one person to Nebius.",
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
          ":white_check_mark: <@U083F1R4Z5J> approved this request. Invitation sent.",
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
    text: "<@U05B5NLQM6W> requested to invite one person to Nebius.",
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
