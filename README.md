# EA Slack Invite Automation

A Slack-hosted Deno app that monitors guest invite requests in an invite
approval channel and evaluates them against approval rules.
**Phase 1 (live)** — the bot auto-approves qualifying guest invites (Single/Multi-Channel
Guest + private channel + time limit + reason), creates Jira audit tickets, and
replies to threads. Full Member, manual review, and internal domain invites are
flagged but not actioned.

## How It Works

1. A guest invite request appears in the invite approval channel (posted by
   Slackbot)
2. The event trigger fires instantly; the hourly polling backup also catches it
3. The app fetches the full message via `conversations.history` (event payloads
   lack structured attachments)
4. Parses the structured attachment (Email, Account type, Channel, Time limit,
   Reason)
5. **Skips internal/partner domains** — configured in `config.ts`
6. Evaluates four approval rules to produce a bot decision
7. Creates a Jira ticket (configured project/service desk)
8. **Replies to the invite thread** with ticket link and bot decision
9. When a human approves or denies, the app updates the ticket with a comparison
10. If the bot decision disagrees with the human decision, an alert is posted to
    the alert channel

The bot **auto-approves** qualifying guest invites via `admin.inviteRequests.approve`
(using a user OAuth token). Full Member and manual review invites are flagged but
not actioned. The polling backup path is shadow-only (never approves).

## Architecture

Two parallel processing paths share the same datastore for dedup:

```
PRIMARY — Event-Driven (instant, auto-approves):
  Event: message_posted in invite approval channel
    └─► guest_invite_shadow_workflow
          └─► ProcessGuestInvite (process_guest_invite.ts)
                ├── Detect invite pattern in event text
                ├── Fetch full message via conversations.history
                ├── Parse Slackbot attachment + extract invite_request_id
                ├── Check domain skip list (config.ts)
                ├── Evaluate rules (evaluate_guest_invite.ts)
                ├── AUTO_APPROVE + pending → admin.inviteRequests.approve
                ├── Create Jira ticket (jira_utils.ts)
                ├── Reply to thread (Auto-Approved / Flagged / Manual Review)
                ├── On human action: update ticket with comparison
                └── On mismatch: post alert → alert channel

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

Invites from configured domains are skipped entirely — no ticket, no action.
Edit the `SKIP_DOMAINS` array in `config.ts` to add your internal and partner
domains.

## Configuration

All org-specific values are in **`config.ts`** — edit this file before deploying:

| Constant | Description |
| --- | --- |
| `INVITE_CHANNEL_ID` | Channel ID where Slackbot posts invite requests |
| `ALERT_CHANNEL_ID` | Channel ID for bot alerts and mismatch notifications |
| `TEAM_ID` | Slack workspace team ID (from `auth.test`) |
| `JIRA_DOMAIN` | Your Atlassian domain, e.g. `yourcompany.atlassian.net` |
| `JIRA_SERVICE_DESK_ID` | JSM service desk numeric ID |
| `JIRA_REQUEST_TYPE_ID` | JSM request type ID for invite tickets |
| `JIRA_DONE_TRANSITION_ID` | Jira transition ID for Done/Resolved |
| `JIRA_SVC_ACCOUNT_ID` | Jira account ID of the service account (reporter + assignee) |
| `SKIP_DOMAINS` | Array of internal/partner email domains to skip |

## Project Structure

```
config.ts                                    # All org-specific IDs and settings ← start here
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
  parse_guest_invite_test.ts                 # Parser tests
  evaluate_guest_invite_test.ts              # Rule engine tests
```

## Environment Variables

Set via `slack env add` — these are secrets and are **not** in `config.ts`:

| Variable | Description |
| --- | --- |
| `JIRA_USER_EMAIL` | Jira service account email |
| `JIRA_API_TOKEN` | Jira API token for the above account |
| `SLACK_ADMIN_USER_TOKEN` | xoxp- user OAuth token for `admin.inviteRequests.approve` |
| `SHADOW_MODE_GUEST_INVITES` | Set to `"false"` to disable all processing (kill switch) |
| `ALERT_CHANNEL_ID` | Override default alert channel from `config.ts` (optional) |
| `INVITE_CHANNEL_ID` | Override default invite channel from `config.ts` (optional) |

> **Note:** `SLACK_ADMIN_USER_TOKEN` must come from a separate OAuth app with
> `admin.invites:write` scope installed by an org admin. Bot tokens cannot use
> `admin.*` scopes.

## Bot Scopes

| Scope | Purpose |
| --- | --- |
| `channels:history` | Read public channel history |
| `channels:read` | Read public channel metadata |
| `chat:write` | Post thread replies and alerts |
| `datastore:read` | Read processed invites datastore |
| `datastore:write` | Write to processed invites datastore |
| `groups:history` | Read private invite approval channel |
| `groups:read` | Read private channel metadata |
| `users:read` | Look up user profiles |
| `users:read.email` | Resolve user email addresses (for Jira) |

## Jira Integration

Each observed invite creates a ticket via Jira Service Management. Configure
the service desk ID, request type, and service account in `config.ts`.

- Description is set via a separate REST API PUT (JSM request creation does not
  accept description for all request types)
- Ticket is auto-transitioned to Done after creation
- Jira failures are fully isolated — they are logged but never block processing

## Deployment

```sh
# 1. Fill in config.ts with your org's values

# 2. Deploy to Slack infrastructure
slack deploy

# 3. Verify triggers survived deployment
slack trigger list

# 4. If triggers are missing, recreate them:
slack trigger create --trigger-def triggers/guest_invite_message_trigger.ts
slack trigger create --trigger-def triggers/poll_guest_invites_trigger.ts

# 5. Set environment variables (first time only)
slack env add JIRA_USER_EMAIL your-service-account@yourcompany.com
slack env add JIRA_API_TOKEN your-token
slack env add SLACK_ADMIN_USER_TOKEN xoxp-your-token

# 6. Invite the bot to the invite approval channel so it can read messages
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

## Safety

- The bot **auto-approves only** when ALL criteria are met (Guest + private +
  time limit + reason + external domain). It never denies.
- `AUTO_DENY` and `MANUAL_REVIEW` are observation-only — flagged for human review
- Polling path is shadow-only — never calls approve/deny APIs
- **Kill switch:** `SHADOW_MODE_GUEST_INVITES=false` stops all processing
- **Approval-only kill switch:** Remove `SLACK_ADMIN_USER_TOKEN` → reverts to
  shadow mode for approvals, all other processing continues

## Thread Replies

When a Jira ticket is created, the bot replies to the invite message thread:
- Auto-approved: `:white_check_mark: Auto-Approved | PROJ-XXXX | Approved by EA Slack Invite Automation`
- Full Member: `:no_entry_sign: Flagged | PROJ-XXXX | Full Member — requires manual review`
- Manual review: `:eyes: Manual Review | PROJ-XXXX | Missing criteria — needs admin review`
- Shadow (polling): `:white_check_mark: Shadow | PROJ-XXXX | Bot decision: AUTO_APPROVE`

## Phase Roadmap

| Phase | Status | Description |
| --- | --- | --- |
| 0 | Complete | Shadow mode — observe, log, create tickets, compare |
| 1 | **Live** | Auto-approve qualifying guest invites (event-driven only) |
| 2 | Planned | Auto-deny Full Member requests |
| 3 | Future | Guest expiration management |
