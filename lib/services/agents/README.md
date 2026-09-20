# Agent runtime

One runner. Every agent is configuration: a persona, a tool allow-list, its
triggers, a daily budget and a gate policy. Adding an agent is adding a
definition, not a service.

## The shape

Three layers, and the boundary between them is the point.

**Rails** are deterministic code: the booking flow, the ledger, settlement,
the connectors. No model is involved and none of it is in here.

**Agents** are models with tools, bounded by an allow-list and a budget.
They classify, draft, match and investigate. They never move money and
never mutate a booking directly: they call services like any other client.

**Gates** are the short list of actions that wait for a person. Every one
carries a deadline and a safe default applied when nobody answers, so the
system never blocks on a human being available.

Agents do not talk to each other. Every handoff is a row: a job, a decision,
an outreach event. That is what makes a run replayable and what keeps one
operator's history readable as a single thread.

## The five agents

| Agent | Does | Stops for |
|---|---|---|
| `verifier` | Checks every outbound draft against the copy rules, then judges claims a regex cannot | It is the gate |
| `scout` | Detects each lead's booking platform, scores how fast they could be live | A lead whose site contradicts the record |
| `opener` | Writes the first touch from what the Scout found | Nothing; every draft passes the Verifier first |
| `reply-desk` | Classifies a reply, moves the lead, answers it | A reply it cannot read, or one from the wrong person |
| `onboarder` | Moves operators who agreed but stalled, one concrete step | An operator a message will not fix |
| `supply-health` | Demotes a listing a traveller could book but an operator could not honour | Putting a demoted listing back |
| `trust-quality` | Reads a claim before a person approves it | Every claim; it never approves |
| `watch` | Reads the logs, treats silence as the serious signal | Incidents, to Inov |
| `partner-desk` | Reviews partners, issues tracked links, reads whether they get used | Anything about terms or money |
| `operator-support` | Answers operators, sends the monthly standing note | Money owed, disputes, leaving |
| `coach` | Proposes what each agent should do differently, from evidence | Every lesson, and the default is discard |
| `content-studio` | Writes articles for search; everything is a draft | Every draft, and it cannot publish |
| `referral-mesh` | Rescues an enquiry an operator declined or ignored | Every referral, before it is sent |
| `growth-analyst` | Reads the funnel and mostly says it is too early to tell | Nothing; it proposes and never acts |
| **`supply-manager`** | **Runs the six supply agents, reports to Kirby** | **Only when something needs her this week** |
| **`platform-manager`** | **Is it running, what does it cost. Reports to Inov** | **Only when something is actually broken** |

## The learning loop

Agents read what they have learned before they act. A lesson is a short,
scoped instruction derived from evidence already in the database: what the
copy rules kept blocking, how operators replied, where a person drew the
line on a decision. The Coach proposes them weekly; a person makes them
active at `/api/admin/agents/lessons`.

Three properties keep this from drifting:

**Lessons are proposed, never self-applied.** An agent that could write its
own instructions unreviewed would eventually write away the ones that
constrain it, and every step of that would read as reasonable at the time.
An unanswered proposal defaults to discard, not to teach.

**Lessons are context, not identity.** They go in the task, never the
persona, which keeps the cached prefix stable and keeps the distinction
honest: the persona is what an agent is, a lesson is something it noticed
lately and may later be wrong about.

**Lessons cannot reach the floor.** The copy rules, the gates, the
manual-only channels and the tool allow-lists are enforced in code that
never consults a lesson. The Coach also refuses to propose one that reads
as loosening a rule, so the attempt fails twice over.

## The manager layer

A manager is not a supervisor. It compresses a desk into one page, decides
what deserves a person's attention, and turns plain language into settings
its agents obey. It reads the database, never the agents, so it cannot
report something the rows do not support. It is not in the path of the
work: turn it off and every agent underneath keeps running.

Four levers, and nothing else: **scope** (a region or segment), **pace** (a
fraction of an agent's existing daily budget, never more), **pause**
(always the safe direction), and **ask** (enqueue a run now).

Two directives can only ever make an agent do less. Pause wins over
everything; the slowest pace wins. That asymmetry is deliberate.

The floor no directive reaches: the copy rules, gate assignment and
defaults, the manual-only channels, an agent's tool allow-list, and
anything that moves money. Those are enforced in code that never reads a
directive, and an instruction asking for one is refused with the reason at
`/api/admin/agents/directives`, never quietly dropped.

## Running it

Off unless `AGENTS_ENABLED=true`. Two crons drive everything:

- `/api/cron/agents-tick`, hourly. Enqueues scheduled agents, expires
  overdue decisions to their default, requeues jobs a dead drain left
  locked. `?force=daily` runs a cadence out of turn for testing.
- `/api/cron/agents-drain`, every five minutes. Runs due jobs.

Kick one by hand with a manual job, or watch them:

```
GET /api/admin/agents/runs        the roster, the queue, recent runs and cost
GET /api/admin/agents/decisions   what is waiting on a person
```

### Environment

| Variable | Effect |
|---|---|
| `AGENTS_ENABLED` | `true` turns the runtime on. Everything is inert otherwise. |
| `ANTHROPIC_API_KEY` | Required once enabled. |
| `AGENTS_MODEL_REASONING` | Defaults to `claude-opus-5`. |
| `AGENTS_MODEL_CLASSIFICATION` | Defaults to `claude-haiku-4-5`. |
| `AGENTS_DECISION_SECRET` | Signs one-tap decision links. Falls back to `CRON_SECRET`. |
| `AGENTS_DAILY_HOUR_UTC` | When daily work runs. Defaults to 20:00 UTC. |
| `AGENTS_DRAIN_LIMIT` | Jobs per drain tick. Defaults to 5. |

### Two ports that are deliberately not wired

`setDispatcher()` decides how a message actually leaves. Until one is wired,
agents save a verified draft on the lead and say it was prepared, never that
it was sent. Instagram and WhatsApp are refused even with a dispatcher
present: automating cold outreach there gets the account banned, and BluePass
needs those channels more than it needs the send.

`setDecisionNotifier()` decides how a person hears that a decision is
waiting. Without it a decision is still recorded and still expires to its
default; it just is not pushed anywhere.

## Tests

```
npx vitest run --config vitest.agents.config.ts
```

Separate from `vitest.config.ts` because that suite talks to the real
Supabase and runs serially. These mock every database call, so they run
anywhere in under a second. What they mostly assert is what each agent
**refuses** to do, because the guardrails are the part a prompt alone cannot
guarantee: no unverified copy goes out, no message without the operator's
own claim link, nothing at all to an operator who said no.
