# EA Slack Invite Automation

A Slack-hosted Deno app that observes guest invite requests in
**#slack-invites-approval** and evaluates them against approval rules. Currently
running in **shadow mode (Phase 0)** — the bot creates Jira audit tickets,
replies to threads with ticket info, and compares its decisions against human
approvers, but takes no action on invites.

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

The bot is **read-only** — it never approves, denies, or takes action on any
invite request.

## Architecture

Two parallel processing paths share the same datastore for dedup:

```
PRIMARY — Event-Driven (instant):
  Event: message_posted in #slack-invites-approval
    └─► guest_invite_shadow_workflow
          └─► ProcessGuestInvite (process_guest_invite.ts)
                ├── Detect invite pattern in event text
                ├── Fetch full message via conversations.history
                ├── Parse Slackbot attachment (parse_guest_invite.ts)
                ├── Check domain skip list
                ├── Evaluate rules (evaluate_guest_invite.ts)
                ├── Create Jira ticket (jira_utils.ts)
                ├── Reply to thread with ticket info
                ├── On approval/denial: update ticket with comparison
                └── On mismatch: post alert → #ea-slack-admin

BACKUP — Polling (hourly):
  Scheduled trigger (every 1 hour)
    └─► poll_guest_invites_workflow
          └─► PollGuestInvites (poll_guest_invites.ts)
                ├── Fetch last 48 hours via conversations.history
                ├── Check datastore for dedup (shared with event path)
                └── Same processing pipeline as above
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
  process_guest_invite.ts                    # Event-driven shadow mode handler
  poll_guest_invites.ts                      # Polling shadow mode handler
workflows/
  guest_invite_shadow_workflow.ts            # Event-driven workflow
  poll_guest_invites_workflow.ts             # Polling workflow
triggers/
  guest_invite_message_trigger.ts            # message_posted event trigger
  poll_guest_invites_trigger.ts              # Hourly scheduled trigger
tests/
  parse_guest_invite_test.ts                 # 18 parser tests
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
| `SHADOW_MODE_GUEST_INVITES` | Defaults to enabled; set to `"false"` to disable (optional)                          |
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

| Account                        | Purpose                                    |
| ------------------------------ | ------------------------------------------ |
| `your-service-account@yourcompany.com` | Jira API auth, ticket reporter + assignee  |

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

When a Jira ticket is created, the bot replies to the invite message thread with:
- Ticket link (clickable)
- Bot decision (AUTO_APPROVE / AUTO_DENY / MANUAL_REVIEW)
- Decision emoji indicator

## Phase Roadmap

| Phase | Status    | Description                                              |
| ----- | --------- | -------------------------------------------------------- |
| 0     | **Live**  | Shadow mode — observe, log, create tickets, compare      |
| 1     | Planned   | Auto-approve qualifying guest invites                    |
| 2     | Planned   | Auto-deny Full Member requests                           |
| 3     | Future    | Guest expiration management                              |

## DO NOT

- This app does **not** call `admin.inviteRequests.approve` or
  `admin.inviteRequests.deny`
- This app does **not** take any action on invite requests
- This app does **not** modify existing Slack Connect workflows
- This app is **not** the EA Slack Connect Automation (A0AL7E8F00Z) — that is a
  separate production app
