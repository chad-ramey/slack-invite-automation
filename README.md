# EA Slack Invite Automation

A Slack-hosted Deno app that monitors guest invite requests in
**#slack-invites-approval** and evaluates them against approval rules.
**Phase 1 (live)** — the bot auto-approves qualifying guest invites (Single/Multi-Channel
Guest + private channel + time limit + reason), creates Jira audit tickets, and
replies to threads. Full Member, manual review, and internal domain invites are
flagged but not actioned.

## How It Works

1. A guest invite request appears in #slack-invites-approval (posted by
   Slackbot)
2. The event trigger fires instantly; the hourly polling backup also catches it
3. The app fetches the full message via `conversations.history` (event payloads
   lack structured attachments)
4. Parses the structured attachment (Email, Account type, Channel, Time limit,
   Reason)
5. **Skips internal/partner domains** (tripleten.com, nebius.com, tavily.com)
6. Evaluates four approval rules to produce a bot decision
7. Creates a Jira ticket in PROJ (reporter + assignee: svc-powerautomate)
8. **Replies to the invite thread** with ticket link and bot decision
9. When a human approves or denies, the app updates the ticket with a comparison
10. If the bot decision disagrees with the human decision, an alert is posted to
    #ea-slack-admin

The bot **auto-approves** qualifying guest invites via `admin.inviteRequests.approve`
(using a user OAuth token). Full Member and manual review invites are flagged but
not actioned. The polling backup path is shadow-only (never approves).

## Architecture

Two parallel processing paths share the same datastore for dedup:

```
PRIMARY — Event-Driven (instant, auto-approves):
  Event: message_posted in #slack-invites-approval
    └─► guest_invite_shadow_workflow
          └─► ProcessGuestInvite (process_guest_invite.ts)
                ├── Detect invite pattern in event text
                ├── Fetch full message via conversations.history
                ├── Parse Slackbot attachment + extract invite_request_id
                ├── Check domain skip list
                ├── Evaluate rules (evaluate_guest_invite.ts)
                ├── AUTO_APPROVE + pending → admin.inviteRequests.approve
                ├── Create Jira ticket (jira_utils.ts)
                ├── Reply to thread (Auto-Approved / Flagged / Manual Review)
                ├── On human action: update ticket with comparison
                └── On mismatch: post alert → #ea-slack-admin

BACKUP — Polling (hourly, shadow-only):
  Scheduled trigger (every 1 hour)
    └─► poll_guest_invites_workflow
          └─► PollGuestInvites (poll_guest_invites.ts)
                ├── Fetch last 48 hours via conversations.history
                ├── Check datastore for dedup (shared with event path)
                ├── Never calls approve/deny APIs
                └── Creates tickets and tracks decisions only
```

## Rule Engine

| Decision        | Conditions                                                              |
| --------------- | ----------------------------------------------------------------------- |
| `AUTO_APPROVE`  | Guest account type + private channel + time limit set + reason provided |
| `AUTO_DENY`     | Full Member account type                                                |
| `MANUAL_REVIEW` | Any approve condition fails, but not Full Member                        |

## Domain Skip List

Invites from these domains are skipped entirely — no ticket, no action:

- `tripleten.com` — TripleTen merge accounts
- `nebius.com` — Internal Nebius users
- `internal.yourcompany.com` — Former Nebius employees
- `tavily.com` — Partner domain

## Project Structure

```
manifest.ts                                  # App manifest, scopes, outgoing domains
datastores/
  processed_invites.ts                       # Datastore schema (dedup across both paths)
functions/
  parse_guest_invite.ts                      # Parses Slackbot attachment-based messages
  evaluate_guest_invite.ts                   # Rule evaluation engine
  jira_utils.ts                              # Jira JSM ticket creation/update
  process_guest_invite.ts                    # Event-driven handler (auto-approves + shadow)
  poll_guest_invites.ts                      # Polling handler (shadow-only, never approves)
workflows/
  guest_invite_shadow_workflow.ts            # Event-driven workflow
  poll_guest_invites_workflow.ts             # Polling workflow
triggers/
  guest_invite_message_trigger.ts            # message_posted event trigger
  poll_guest_invites_trigger.ts              # Hourly scheduled trigger
tests/
  parse_guest_invite_test.ts                 # 21 parser tests
  evaluate_guest_invite_test.ts              # 11 rule engine tests
```

## App Identity

| Field        | Value                                      |
| ------------ | ------------------------------------------ |
| App ID       | A0APPKTRHUK                                |
| Organization | Nebius (E08E4ADF9C0)                       |
| Workspace    | Nebius (T056MAJRM63)                       |
| Owner        | chad.ramey (U0AH3DT15DX)                  |
| Dashboard    | https://slack.com/apps/A0APPKTRHUK         |

## Triggers

| Trigger                        | ID              | Type      | Description                          |
| ------------------------------ | --------------- | --------- | ------------------------------------ |
| Guest Invite Message Trigger   | Ft0AQ7C989C4   | Event     | message_posted on C05LQKN5F29        |
| Poll Guest Invites Trigger     | Ft0APEJ5Q7DM   | Scheduled | Hourly backup poll                   |

## Environment Variables

Set via `slack env add`:

| Variable                    | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `JIRA_USER_EMAIL`           | Jira service account email (your-service-account@yourcompany.com)                            |
| `JIRA_API_TOKEN`            | Jira API token for the above account                                                 |
| `SLACK_ADMIN_USER_TOKEN`    | xoxp- user OAuth token for admin.inviteRequests.approve (from EA Invite Approval Token app) |
| `SHADOW_MODE_GUEST_INVITES` | Defaults to enabled; set to `"false"` to disable all processing (optional)           |
| `ALERT_CHANNEL_ID`          | Override default alert channel (optional, defaults to #ea-slack-admin `C0AN2HL1AG4`) |
| `INVITE_CHANNEL_ID`         | Override default invite channel (optional, defaults to `C05LQKN5F29`)                |

## Bot Scopes

| Scope              | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `channels:history` | Read public channel history                    |
| `channels:read`    | Read public channel metadata                   |
| `chat:write`       | Post thread replies and mismatch alerts        |
| `datastore:read`   | Read processed invites datastore               |
| `datastore:write`  | Write to processed invites datastore           |
| `groups:history`   | Read #slack-invites-approval (private channel) |
| `groups:read`      | Read private channel metadata                  |
| `users:read`       | Look up user profiles                          |
| `users:read.email` | Resolve user email addresses (for Jira)        |

## Jira Integration

Each observed invite creates a ticket in the **PROJ** project (Jira Service
Management):

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| Service Desk | 1040                                              |
| Request Type | 4308 (Slack Invite Request (Internal))             |
| Issue Type   | Slack Invite Request (21077)                       |
| Reporter     | your-service-account@yourcompany.com                       |
| Assignee     | your-service-account@yourcompany.com                       |
| Transition   | Auto-transitioned to Done (ID 2)                   |
| Description  | Set via separate PUT (not allowed in JSM create)   |

Jira failures are fully isolated — they are logged but never block observation.

## Service Accounts

| Account                        | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `your-service-account@yourcompany.com` | Jira API auth, ticket reporter + assignee                    |
| EA Invite Approval Token (OAuth app) | Provides xoxp- user token with `admin.invites:write` scope |

## Deployment

```sh
# Deploy to Slack infrastructure
slack deploy

# Verify triggers survived deployment
slack trigger list

# If triggers are missing, recreate them:
slack trigger create --trigger-def triggers/guest_invite_message_trigger.ts
slack trigger create --trigger-def triggers/poll_guest_invites_trigger.ts

# Set environment variables (first time only)
slack env add JIRA_USER_EMAIL your-service-account@yourcompany.com
slack env add JIRA_API_TOKEN your-token

# Invite the bot to #slack-invites-approval so it can read messages
```

> **Important:** `slack deploy` can break event triggers. Always verify with
> `slack trigger list` after deploying and recreate if needed.

## Testing

```sh
deno test --allow-read --allow-net tests/
```

## Monitoring

```sh
# Tail live activity logs
slack activity --tail
```

## Alerts

Mismatch alerts (bot decision differs from human decision) are posted to
#ea-slack-admin (`C0AN2HL1AG4`), or to the channel specified by
`ALERT_CHANNEL_ID`.

## Thread Replies

When a Jira ticket is created, the bot replies to the invite message thread:
- Auto-approved: `:white_check_mark: Auto-Approved | PROJ-XXXX | Approved by EA Slack Invite Automation`
- Full Member: `:no_entry_sign: Flagged | PROJ-XXXX | Full Member — requires manual review`
- Manual review: `:eyes: Manual Review | PROJ-XXXX | Missing criteria — needs admin review`
- Shadow (polling): `:white_check_mark: Shadow | PROJ-XXXX | Bot decision: AUTO_APPROVE`

## Phase Roadmap

| Phase | Status       | Description                                              |
| ----- | ------------ | -------------------------------------------------------- |
| 0     | Complete     | Shadow mode — observe, log, create tickets, compare      |
| 1     | **Live**     | Auto-approve qualifying guest invites (event-driven only)|
| 2     | Planned      | Auto-deny Full Member requests                           |
| 3     | Future       | Guest expiration management                              |

## Safety

- This app **auto-approves only** when ALL criteria are met (Guest + private +
  time limit + reason + external domain). It never denies.
- AUTO_DENY and MANUAL_REVIEW are observation-only — flagged for human review
- Polling path is shadow-only — never calls approve/deny APIs
- Kill switch: `SHADOW_MODE_GUEST_INVITES=false` stops all processing
- Remove `SLACK_ADMIN_USER_TOKEN` env var → reverts to shadow mode for approvals
- This app is **not** the EA Slack Connect Automation (A0AL7E8F00Z) — that is a
  separate production app

## Documentation

- **Confluence Design Doc:** [Design Doc: EA Slack Invite Automation](https://your-org.atlassian.net/wiki/spaces/NEBEA/pages/1619624072)
- **Slack Governance Operations:** [Slack Governance Operations](https://your-org.atlassian.net/wiki/spaces/PROJ/pages/1656259533)
- **Canvas:** #slack-invites-approval channel canvas (source of truth for day-to-day ops)
- **Related:** [Design Doc: EA Slack Connect Automation](https://your-org.atlassian.net/wiki/spaces/NEBEA/pages/1499561996)
