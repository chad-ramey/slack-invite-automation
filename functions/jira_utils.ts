/**
 * Jira integration utilities for Slack Guest Invite Shadow Mode
 *
 * Creates audit tickets in PROJ project via JSM API for each observed
 * guest invite request. Follows the same pattern as the Slack Connect automation.
 * Jira failures are logged but NEVER crash the workflow.
 */

const JIRA_BASE_URL = "https://your-org.atlassian.net";
const SERVICE_DESK_ID = "YOUR_SERVICE_DESK_ID";
const REQUEST_TYPE_ID = "YOUR_REQUEST_TYPE_ID";
const DONE_TRANSITION_ID = "YOUR_DONE_TRANSITION_ID"; // "Done" transition for PROJ project
const SVC_ACCOUNT_ID = "YOUR_JIRA_SERVICE_ACCOUNT_ID"; // your-service-account@yourcompany.com

export interface JiraEnv {
  jiraEmail: string;
  jiraToken: string;
}

export interface GuestInviteTicketData {
  requesterName: string;
  requesterUserId: string;
  email: string;
  accountType: string;
  channelName: string;
  channelPrivate: boolean;
  timeLimit: string | null;
  reason: string | null;
  ruleEvaluation: {
    accountType: { value: string; pass: boolean };
    channelPrivate: { value: boolean; pass: boolean };
    timeLimitSet: { value: boolean; pass: boolean };
    reasonProvided: { value: boolean; pass: boolean };
    decision: "AUTO_APPROVE" | "AUTO_DENY" | "MANUAL_REVIEW";
  };
  humanDecision: string;
  humanDecidedBy: string;
  humanDecidedAt: string;
  processedAt: string;
}

/**
 * Create a Jira ticket for a guest invite request (shadow mode).
 * Returns the issue key (e.g., "PROJ-123") or null on failure.
 */
export async function createGuestInviteTicket(
  data: GuestInviteTicketData,
  jiraEnv: JiraEnv,
): Promise<string | null> {
  const { jiraEmail, jiraToken } = jiraEnv;

  if (!jiraEmail || !jiraToken) {
    console.error(
      "[JIRA] Missing JIRA_USER_EMAIL or JIRA_API_TOKEN env vars — skipping ticket creation",
    );
    return null;
  }

  const summary = `Slack Invite - ${data.email}`;
  const description = buildGuestInviteDescription(data);
  const authHeader = "Basic " + btoa(`${jiraEmail}:${jiraToken}`);

  try {
    // deno-lint-ignore no-explicit-any
    const createPayload: Record<string, any> = {
      serviceDeskId: SERVICE_DESK_ID,
      requestTypeId: REQUEST_TYPE_ID,
      raiseOnBehalfOf: SVC_ACCOUNT_ID,
      requestFieldValues: {
        summary: summary,
      },
    };

    console.log(`[JIRA] Creating guest invite ticket: ${summary}`);

    const createResponse = await fetch(
      `${JIRA_BASE_URL}/rest/servicedeskapi/request`,
      {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(createPayload),
      },
    );

    const createResult = await createResponse.json();

    if (!createResponse.ok) {
      console.error(
        `[JIRA] Failed to create ticket: ${createResponse.status} ${
          JSON.stringify(createResult)
        }`,
      );
      return null;
    }

    const issueKey = createResult.issueKey;
    console.log(`[JIRA] Created ticket: ${issueKey}`);

    // Add description via standard REST API (not allowed in JSM request creation for this type)
    try {
      const descResponse = await fetch(
        `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`,
        {
          method: "PUT",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              description: {
                version: 1,
                type: "doc",
                content: [{
                  type: "paragraph",
                  content: [{
                    type: "text",
                    text: description,
                  }],
                }],
              },
            },
          }),
        },
      );
      if (!descResponse.ok) {
        const descErr = await descResponse.text();
        console.error(
          `[JIRA] Failed to set description on ${issueKey}: ${descResponse.status} ${descErr}`,
        );
      } else {
        console.log(`[JIRA] Description set on ${issueKey}`);
      }
    } catch (descErr) {
      console.error(
        `[JIRA] Exception setting description: ${
          descErr instanceof Error ? descErr.message : String(descErr)
        }`,
      );
    }

    // Set assignee to svc-powerautomate
    try {
      const assignResponse = await fetch(
        `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/assignee`,
        {
          method: "PUT",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ accountId: SVC_ACCOUNT_ID }),
        },
      );
      if (!assignResponse.ok) {
        const assignErr = await assignResponse.text();
        console.error(
          `[JIRA] Failed to set assignee on ${issueKey}: ${assignResponse.status} ${assignErr}`,
        );
      }
    } catch (assignErr) {
      console.error(
        `[JIRA] Exception setting assignee: ${
          assignErr instanceof Error ? assignErr.message : String(assignErr)
        }`,
      );
    }

    // Transition to Done
    await transitionToDone(issueKey, authHeader);

    return issueKey;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JIRA] Exception creating ticket: ${msg}`);
    return null;
  }
}

/**
 * Update an existing Jira ticket with the human decision comparison.
 * Uses the standard Jira REST API to update the description field.
 */
export async function updateGuestInviteTicket(
  issueKey: string,
  data: GuestInviteTicketData,
  jiraEnv: JiraEnv,
): Promise<boolean> {
  const { jiraEmail, jiraToken } = jiraEnv;

  if (!jiraEmail || !jiraToken) {
    console.error(
      "[JIRA] Missing credentials — skipping ticket update",
    );
    return false;
  }

  const description = buildGuestInviteDescription(data);
  const authHeader = "Basic " + btoa(`${jiraEmail}:${jiraToken}`);

  try {
    console.log(`[JIRA] Updating ticket ${issueKey} with human decision`);

    const updateResponse = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`,
      {
        method: "PUT",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          fields: {
            description: plainTextToAdf(description),
          },
        }),
      },
    );

    if (updateResponse.ok || updateResponse.status === 204) {
      console.log(`[JIRA] Updated ticket ${issueKey}`);
      return true;
    } else {
      const errorBody = await updateResponse.text();
      console.error(
        `[JIRA] Failed to update ${issueKey}: ${updateResponse.status} ${errorBody}`,
      );
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JIRA] Exception updating ticket ${issueKey}: ${msg}`);
    return false;
  }
}

/**
 * Transition a Jira issue to Done status with resolution set to "Done".
 */
async function transitionToDone(
  issueKey: string,
  authHeader: string,
): Promise<void> {
  try {
    const transitionResponse = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/transitions`,
      {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          transition: { id: DONE_TRANSITION_ID },
        }),
      },
    );

    if (transitionResponse.ok || transitionResponse.status === 204) {
      console.log(`[JIRA] ${issueKey} transitioned to Done (resolved)`);
    } else {
      const errorBody = await transitionResponse.text();
      console.error(
        `[JIRA] Failed to transition ${issueKey}: ${transitionResponse.status} ${errorBody}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JIRA] Exception transitioning ${issueKey}: ${msg}`);
  }
}

/**
 * Convert plain text to Atlassian Document Format (ADF).
 * Jira REST API v3 requires ADF for the description field.
 * Each line becomes a paragraph; blank lines are preserved.
 */
// deno-lint-ignore no-explicit-any
function plainTextToAdf(text: string): Record<string, any> {
  const lines = text.split("\n");
  // deno-lint-ignore no-explicit-any
  const content: Record<string, any>[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      content.push({ type: "paragraph", content: [] });
    } else {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      });
    }
  }

  return {
    version: 1,
    type: "doc",
    content: content,
  };
}

/**
 * Build plain-text description for guest invite shadow mode tickets.
 * JSM API description field accepts plain text (not ADF).
 */
function buildGuestInviteDescription(data: GuestInviteTicketData): string {
  const eval_ = data.ruleEvaluation;
  const decision = eval_.decision;

  const matchStatus = data.humanDecision === "Pending"
    ? "PENDING"
    : ((decision === "AUTO_APPROVE" && data.humanDecision === "Approved") ||
        (decision === "AUTO_DENY" && data.humanDecision === "Denied"))
    ? "YES"
    : "NO";

  return [
    "=== Requester ===",
    `Name: ${data.requesterName}`,
    `User ID: ${data.requesterUserId}`,
    "",
    "=== Invite Details ===",
    `Email: ${data.email}`,
    `Account Type: ${data.accountType}`,
    `Channel: ${data.channelName}`,
    `Expiration: ${data.timeLimit || "Not set"}`,
    `Reason: ${data.reason || "Not provided"}`,
    "",
    "=== Rule Evaluation (Shadow Mode) ===",
    `Account Type: ${
      eval_.accountType.pass ? "PASS" : "FAIL"
    } (${eval_.accountType.value})`,
    `Channel Private: ${eval_.channelPrivate.pass ? "PASS" : "FAIL"}`,
    `Time Limit Set: ${eval_.timeLimitSet.pass ? "PASS" : "FAIL"}`,
    `Reason Provided: ${eval_.reasonProvided.pass ? "PASS" : "FAIL"}`,
    `Bot Decision: ${decision}`,
    "",
    "=== Actual Decision ===",
    `Status: ${data.humanDecision}`,
    `Decided By: ${data.humanDecidedBy}`,
    `Decided At: ${data.humanDecidedAt}`,
    "",
    "=== Shadow Mode Comparison ===",
    `Match: ${matchStatus}`,
    `Bot would have: ${decision}`,
    `Human decided: ${data.humanDecision}`,
    "",
    "=== Additional Info ===",
    `Source: Shadow Mode (Phase 0)`,
    `Processed: ${data.processedAt}`,
  ].join("\n");
}
