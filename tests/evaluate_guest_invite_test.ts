import { assertEquals } from "@std/assert";
import { evaluateInviteRules } from "../functions/evaluate_guest_invite.ts";
import { ParsedGuestInvite } from "../functions/parse_guest_invite.ts";

function makeInvite(
  overrides: Partial<ParsedGuestInvite> = {},
): ParsedGuestInvite {
  return {
    requesterUserId: "U123TEST",
    email: "test@example.com",
    accountType: "Single-Channel Guest",
    channelName: "private-channel",
    channelPrivate: true,
    timeLimit: "2026-05-25T23:59:59.000Z",
    timeLimitEpoch: 1779839999,
    reason: "valid reason",
    ...overrides,
  };
}

Deno.test("AUTO_APPROVE: all conditions met - Single-Channel Guest", () => {
  const result = evaluateInviteRules(makeInvite());
  assertEquals(result.decision, "AUTO_APPROVE");
  assertEquals(result.accountType.pass, true);
  assertEquals(result.channelPrivate.pass, true);
  assertEquals(result.timeLimitSet.pass, true);
  assertEquals(result.reasonProvided.pass, true);
});

Deno.test("AUTO_APPROVE: all conditions met - Multi-Channel Guest", () => {
  const result = evaluateInviteRules(
    makeInvite({ accountType: "Multi-Channel Guest" }),
  );
  assertEquals(result.decision, "AUTO_APPROVE");
  assertEquals(result.accountType.pass, true);
  assertEquals(result.accountType.value, "Multi-Channel Guest");
});

Deno.test("AUTO_DENY: Full Member request", () => {
  const result = evaluateInviteRules(
    makeInvite({ accountType: "Full Member" }),
  );
  assertEquals(result.decision, "AUTO_DENY");
  assertEquals(result.accountType.pass, false);
  assertEquals(result.accountType.value, "Full Member");
});

Deno.test("AUTO_DENY: Full Member even with all other conditions met", () => {
  const result = evaluateInviteRules(
    makeInvite({
      accountType: "Full Member",
      channelPrivate: true,
      timeLimit: "2026-05-25T23:59:59.000Z",
      reason: "valid reason",
    }),
  );
  assertEquals(result.decision, "AUTO_DENY");
});

Deno.test("MANUAL_REVIEW: missing time limit", () => {
  const result = evaluateInviteRules(
    makeInvite({ timeLimit: null, timeLimitEpoch: null }),
  );
  assertEquals(result.decision, "MANUAL_REVIEW");
  assertEquals(result.timeLimitSet.pass, false);
  assertEquals(result.timeLimitSet.value, false);
});

Deno.test("MANUAL_REVIEW: missing reason", () => {
  const result = evaluateInviteRules(makeInvite({ reason: null }));
  assertEquals(result.decision, "MANUAL_REVIEW");
  assertEquals(result.reasonProvided.pass, false);
  assertEquals(result.reasonProvided.value, false);
});

Deno.test("MANUAL_REVIEW: public channel", () => {
  const result = evaluateInviteRules(makeInvite({ channelPrivate: false }));
  assertEquals(result.decision, "MANUAL_REVIEW");
  assertEquals(result.channelPrivate.pass, false);
  assertEquals(result.channelPrivate.value, false);
});

Deno.test("MANUAL_REVIEW: missing both time limit and reason", () => {
  const result = evaluateInviteRules(
    makeInvite({ timeLimit: null, timeLimitEpoch: null, reason: null }),
  );
  assertEquals(result.decision, "MANUAL_REVIEW");
  assertEquals(result.timeLimitSet.pass, false);
  assertEquals(result.reasonProvided.pass, false);
});

Deno.test("MANUAL_REVIEW: empty reason string", () => {
  const result = evaluateInviteRules(makeInvite({ reason: "" }));
  assertEquals(result.decision, "MANUAL_REVIEW");
  assertEquals(result.reasonProvided.pass, false);
});

Deno.test("MANUAL_REVIEW: unknown account type", () => {
  const result = evaluateInviteRules(
    makeInvite({ accountType: "Something New" }),
  );
  assertEquals(result.decision, "MANUAL_REVIEW");
  assertEquals(result.accountType.pass, false);
});

Deno.test("rule evaluation preserves all values", () => {
  const invite = makeInvite({
    accountType: "Single-Channel Guest",
    channelPrivate: true,
    timeLimit: "2026-06-01T00:00:00.000Z",
    reason: "testing",
  });
  const result = evaluateInviteRules(invite);
  assertEquals(result.accountType.value, "Single-Channel Guest");
  assertEquals(result.channelPrivate.value, true);
  assertEquals(result.timeLimitSet.value, true);
  assertEquals(result.reasonProvided.value, true);
});
