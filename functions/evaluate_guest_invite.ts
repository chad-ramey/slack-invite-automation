/**
 * Rule evaluation engine for guest invite requests (Shadow Mode).
 *
 * Evaluates parsed invite requests against the confirmed approval rules:
 * - Auto-approve: Single/Multi-Channel Guest + private channel + time limit + reason
 * - Auto-deny: Full Member requests
 * - Manual review: anything else
 */

import { ParsedGuestInvite } from "./parse_guest_invite.ts";

export interface RuleEvaluation {
  accountType: { value: string; pass: boolean };
  channelPrivate: { value: boolean; pass: boolean };
  timeLimitSet: { value: boolean; pass: boolean };
  reasonProvided: { value: boolean; pass: boolean };
  decision: "AUTO_APPROVE" | "AUTO_DENY" | "MANUAL_REVIEW";
}

/**
 * Evaluate a parsed guest invite against the rule set.
 */
export function evaluateInviteRules(
  invite: ParsedGuestInvite,
): RuleEvaluation {
  const isGuestAccount = invite.accountType === "Single-Channel Guest" ||
    invite.accountType === "Multi-Channel Guest";

  const isFullMember = invite.accountType === "Full Member";

  const accountTypePass = isGuestAccount;
  const channelPrivatePass = invite.channelPrivate;
  const timeLimitPass = invite.timeLimit !== null &&
    invite.timeLimit.length > 0;
  const reasonPass = invite.reason !== null && invite.reason.length > 0;

  let decision: "AUTO_APPROVE" | "AUTO_DENY" | "MANUAL_REVIEW";

  if (isFullMember) {
    decision = "AUTO_DENY";
  } else if (
    accountTypePass && channelPrivatePass && timeLimitPass && reasonPass
  ) {
    decision = "AUTO_APPROVE";
  } else {
    decision = "MANUAL_REVIEW";
  }

  return {
    accountType: { value: invite.accountType, pass: accountTypePass },
    channelPrivate: { value: invite.channelPrivate, pass: channelPrivatePass },
    timeLimitSet: { value: timeLimitPass, pass: timeLimitPass },
    reasonProvided: { value: reasonPass, pass: reasonPass },
    decision,
  };
}
