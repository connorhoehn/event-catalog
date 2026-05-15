# Handoff: chat-bus channel architecture for LVS

**Date:** 2026-05-15
**From:** event-catalog (Phase E2.3 SFU declarations)
**To:** live-video-streaming agent (when reactivated)
**Status:** open question; documented for future picker-upper. Not blocking.

## Context

As part of declaring SFU events in `event-catalog` (waves 17-a/b/c), the
Redis `chat-bus:{channelArn}` channel revealed an architectural ambiguity
that should be resolved when LVS picks up its next round of work. This
document captures the finding so the decision lands with full context.

## The finding

Two publishers share the `chat-bus:{channelArn}` Redis channel with **two
different wire conventions**:

1. **`src/chat/ChatHub.js`** — emits IVS-Chat-shaped messages using
   PascalCase keys (`Type: 'MESSAGE'`, `Id`, `Sender: { UserId, Attributes }`,
   `Content`, `SendTime`). These payloads are also fanned out **directly**
   to WebSocket clients on `/api/channels/:arn/chat`, which is the IVS
   Chat parity surface listed in `live-video-streaming/CLAUDE.md`.

2. **`src/api/channels/chatBans.js`** — emits internal cross-pod sync
   events using lowercase `type` (`type: 'user.banned'`, `userId`,
   `reason`, `durationSeconds`). These are **also** broadcast to WS
   clients today (because `ChatHub._onBusMessage` calls
   `_broadcast(arn, payload)` for every bus message before doing
   type-specific routing — see `ChatHub.js:133`).

## Why this matters

The chatBans payloads being forwarded to IVS WS clients is **not what an
IVS-compatible client expects**. The IVS Chat protocol has no
`user.banned` event. Clients will either ignore the foreign shape or
break depending on how strictly they validate.

The earlier 2026-05-13 handoff (`2026-05-13-lvs-integration.md` item #3)
recommended forcing both publishers onto a canonical lowercase
convention. **That recommendation predates the IVS-replacement strategic
refresh** and would break IVS Chat parity. It is now incorrect.

## The actual question

When LVS resumes, decide between:

**Option A — separate channels for separate audiences.**
Move ban / unban events to an internal-only Redis channel
(`chat-mod-bus:{arn}` or similar). Keep `chat-bus:{arn}` exclusively for
IVS-shaped messages. `ChatHub._onBusMessage` stops forwarding non-IVS
shapes to WS clients. The two event-catalog declarations
(`sfu.chat.user.banned`, `sfu.chat.user.unbanned`) update their channel
field.

**Option B — IVS-shape the ban events.**
Reshape chatBans emissions to fit an IVS `EVENT` envelope (e.g.
`{ Type: 'EVENT', EventName: 'aws:USER_BANNED', Attributes: { userId,
reason, durationSeconds } }`). Drops the lowercase convention entirely
in favor of IVS parity. Update event-catalog declarations accordingly.

**Option C — accept the status quo.**
Leave both shapes flowing on the same channel. Document that IVS clients
will see and ignore non-IVS shapes. Update the event-catalog
declarations to mention the bleed in their `description`. (This is what
ships today.)

## What this handoff is **not** asking for

- Casing reconciliation across both files. The 2026-05-13 recommendation
  to "force everything to lowercase" would break IVS parity. Disregard.
- A code change today. event-catalog declarations describe the current
  reality (mixed casing); the decision can land later without retro-
  declaring.

## Current state in event-catalog

`live-video-streaming/src/event-declarations.js` declares the five chat
events as they actually emit today:

| Event name (catalog) | Wire shape (today) | Source file |
|---|---|---|
| `sfu.chat.message` | PascalCase IVS Chat | `ChatHub.js:208` |
| `sfu.chat.message_deleted` | PascalCase IVS Chat | `ChatHub.js:228` |
| `sfu.chat.user_disconnected` | PascalCase IVS Chat | `ChatHub.js:240` |
| `sfu.chat.user.banned` | lowercase internal | `chatBans.js:44` |
| `sfu.chat.user.unbanned` | lowercase internal | `chatBans.js:90` |

Once Options A or B is chosen, this table — and the corresponding
declarations — get a single coordinated update.

## Reference

- LVS `CLAUDE.md` — "IVS Chat wire-protocol (`/api/channels/:arn/chat`
  WebSocket)" under "IVS parity surface".
- event-catalog `ROADMAP.md` Phase E2.3 — original handoff intent.
- `docs/handoffs/2026-05-13-lvs-integration.md` item #3 — the
  recommendation that this doc supersedes.
