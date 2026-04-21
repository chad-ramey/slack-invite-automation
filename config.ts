/**
 * Central configuration for EA Slack Invite Automation.
 *
 * Replace all YOUR_* placeholders with your org's values before deploying.
 * See README.md → Configuration for details.
 */

// ---------------------------------------------------------------------------
// Slack channel IDs
// ---------------------------------------------------------------------------

/** Channel where Slackbot posts guest invite requests (e.g. #slack-invites-approval) */
export const INVITE_CHANNEL_ID = "YOUR_INVITE_CHANNEL_ID";

/** Channel for bot alerts and mismatch notifications (e.g. #ea-slack-admin) */
export const ALERT_CHANNEL_ID = "YOUR_ALERT_CHANNEL_ID";

// ---------------------------------------------------------------------------
// Slack workspace
// ---------------------------------------------------------------------------

/** Workspace team ID — used for admin.inviteRequests API calls.
 *  Find via: curl -s -H "Authorization: Bearer $TOKEN" https://slack.com/api/auth.test | jq .team_id
 */
export const TEAM_ID = "YOUR_TEAM_ID";

// ---------------------------------------------------------------------------
// Jira / Atlassian
// ---------------------------------------------------------------------------

/** Your Atlassian domain, e.g. "yourcompany.atlassian.net" */
export const JIRA_DOMAIN = "YOUR_DOMAIN.atlassian.net";

export const JIRA_BASE_URL = `https://${JIRA_DOMAIN}`;

/** JSM service desk numeric ID — find via: GET /rest/servicedeskapi/servicedesk */
export const JIRA_SERVICE_DESK_ID = "YOUR_SERVICE_DESK_ID";

/** JSM request type ID for the invite ticket type */
export const JIRA_REQUEST_TYPE_ID = "YOUR_REQUEST_TYPE_ID";

/** Jira transition ID to move ticket to Done/Resolved */
export const JIRA_DONE_TRANSITION_ID = "YOUR_DONE_TRANSITION_ID";

/** Jira account ID of the service account used as reporter + assignee.
 *  Find via: GET /rest/api/3/user/search?query=svc-account@yourcompany.com
 */
export const JIRA_SVC_ACCOUNT_ID = "YOUR_JIRA_SERVICE_ACCOUNT_ID";

// ---------------------------------------------------------------------------
// Domain skip list
// Internal/partner domains — invites from these are ignored entirely.
// No ticket is created, no action is taken.
// ---------------------------------------------------------------------------

export const SKIP_DOMAINS = [
  // "internal.yourcompany.com",
  // "partner.com",
  // Add your internal and partner domains here
];
