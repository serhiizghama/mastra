# Answers to Open Discord Question Issues

Generated: 2026-03-25

---

## #14647 — Best storage strategy for Mastra on Cloudflare Workers — query volume concerns

**Question:** Running Mastra on CF Workers with PostgresStore (Neon HTTP driver) results in 20-70 HTTP queries per `agent.stream()` call. How to reduce this?

**Answer:**

The high query count comes from three areas: memory, observability, and workflow snapshots. Each can be tuned independently.

### 1. Reduce Memory Queries

```typescript
import { Memory } from '@mastra/memory';

const memory = new Memory({
  options: {
    lastMessages: 5,              // Default is 10 — reduce or set to false
    semanticRecall: false,         // Disables vector search (saves 3-5 queries)
    workingMemory: { enabled: false },  // Disable if not needed
    observationalMemory: false,    // Disables background observer/reflector agents
  },
});
```

For agents that only route or classify, use read-only mode:

```typescript
const response = await agent.stream('Hello', {
  memory: {
    thread: threadId,
    resource: resourceId,
    options: { readOnly: true },  // Reads history, writes nothing
  },
});
```

### 2. Reduce Observability Queries

Switch from the default `realtime` strategy to `insert-only`, which only writes completed spans:

```typescript
import { DefaultExporter } from '@mastra/core/observability';

new DefaultExporter({
  strategy: 'insert-only',  // ~70% fewer DB operations vs 'realtime'
  maxBatchSize: 500,
  maxBatchWaitMs: 2000,
});
```

Or route observability to a different store (or disable it entirely) using composite storage:

```typescript
import { MastraCompositeStore } from '@mastra/core/storage';

const storage = new MastraCompositeStore({
  id: 'composite',
  domains: {
    memory: new PostgresStore({ connectionString: process.env.DATABASE_URL }),
    observability: null,  // Disable observability writes entirely
  },
});
```

### 3. Estimated Savings

| Feature | Default Queries | Optimized |
|---------|----------------|-----------|
| `lastMessages: 10` | 1-2 | 0 (if disabled) |
| `semanticRecall` | 3-5 | 0 |
| Observability (`realtime`) | 15-30 | 1-3 (`insert-only`) |
| Working Memory | 1-2 | 0 |
| **Total** | **20-70** | **2-5** |

---

## #13983 — Question on Workspace Skills: When to Use Them?

**Question:** When should I use skills vs a strong system prompt vs workflows for company-specific agent tasks?

**Answer:**

These three mechanisms serve different purposes and work best together:

| Mechanism | Best For | How It Works |
|-----------|----------|--------------|
| **System prompt** (`instructions`) | Core personality, expertise, and always-on rules | Injected into every LLM call |
| **Skills** | Reusable, on-demand task guidance | Agent loads skill instructions when needed via a tool call |
| **Workflows** | Deterministic multi-step processes | Explicit step-by-step control flow with suspend/resume |

### When to use Skills

Skills are ideal when:
- The agent needs to perform a task that requires **detailed, multi-paragraph instructions** you don't want in the system prompt
- The guidance is **reusable across agents** (e.g., a "code review" skill)
- You want instructions to be **loaded on-demand** rather than always present

A skill is a folder with a `SKILL.md` file:

```
/skills
  /onboard-customer
    SKILL.md            # Instructions + YAML frontmatter
    /references
      checklist.md      # Supporting docs the agent can read
    /scripts
      validate.ts       # Scripts the agent can execute
```

Configure on the workspace:

```typescript
const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: './workspace' }),
  skills: ['/skills'],
});
```

The agent automatically gets `skill`, `skill_read`, and `skill_search` tools to discover and load skills.

### When to use a Strong System Prompt

Use system prompt for things that should **always** be active:
- Agent identity and tone
- Security boundaries and rules
- Domain knowledge that applies to every interaction

### When to use Workflows

Use workflows for processes that must follow a **fixed sequence**:
- Approval chains
- Data pipelines with validation gates
- Multi-step processes where order matters

### Recommended Pattern for Company-Specific Agents

```typescript
const agent = new Agent({
  // System prompt: core identity + always-on rules
  instructions: `You are a customer support agent for Acme Corp.
    Always be polite. Never share internal data.`,
  model: 'openai/gpt-4',
  workspace,  // Skills loaded on demand from workspace
});
```

Keep the system prompt **lean** (identity + rules) and put detailed task guidance in skills.

---

## #13196 — Best way to build support agent intent layer

**Question:** Best way to build a support agent that detects intent and routes to sub-agents? Using RAG-based classification, LLM-based detection, or supervisor pattern?

**Answer:**

With 11 fixed intents and limited training data, the **supervisor agent pattern** is the most practical starting point. You can add RAG-based classification later when you have the dataset.

### Approach 1: Supervisor Agent (Recommended to start)

The supervisor pattern (v1.8.0+) lets a parent agent automatically route to specialized sub-agents based on their descriptions:

```typescript
import { Agent } from '@mastra/core/agent';

const billingAgent = new Agent({
  id: 'billing-agent',
  description: 'Handles billing, invoices, payment issues, and refunds',
  instructions: 'You specialize in billing support...',
  model: 'openai/gpt-4',
  tools: { /* billing-specific tools */ },
});

const technicalAgent = new Agent({
  id: 'technical-agent',
  description: 'Handles technical issues, bugs, API problems, and integrations',
  instructions: 'You specialize in technical support...',
  model: 'openai/gpt-4',
  tools: { /* tech-specific tools */ },
});

const supportSupervisor = new Agent({
  id: 'support-supervisor',
  instructions: `You are a support coordinator. Analyze the customer's message
    and delegate to the most appropriate specialist agent.`,
  model: 'openai/gpt-4',
  agents: { billingAgent, technicalAgent },
});

const stream = await supportSupervisor.stream(userMessage, {
  maxSteps: 10,
  delegation: {
    onDelegationStart: async (ctx) => {
      console.log(`Routing to: ${ctx.primitiveId}`);
      return { proceed: true };
    },
    onDelegationComplete: async (ctx) => {
      console.log(`Result from ${ctx.primitiveId}: ${ctx.result.text}`);
    },
  },
});
```

### Approach 2: Structured Output for Explicit Classification

If you need the intent label for analytics or routing logic:

```typescript
import { z } from 'zod';

const intentSchema = z.object({
  intent: z.enum([
    'billing', 'technical', 'account', 'shipping',
    'returns', 'complaint', 'feature_request',
    'onboarding', 'pricing', 'security', 'general',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const classifier = new Agent({
  id: 'intent-classifier',
  instructions: 'Classify the support ticket intent.',
  model: 'openai/gpt-4',
});

const result = await classifier.generate(userMessage, {
  structuredOutput: { schema: intentSchema },
});

// Route based on explicit intent
const handler = agentMap[result.object.intent];
await handler.stream(userMessage);
```

### Approach 3: RAG-Based (When You Have the Dataset)

When your labeled dataset is large enough, add vector-based classification:

```typescript
import { createVectorQueryTool } from '@mastra/rag';

const searchIntents = createVectorQueryTool({
  id: 'search-intents',
  vectorStoreName: 'support-intents',
  indexName: 'intents',
  description: 'Search labeled support intent examples',
});
```

### Recommendation

Start with the **supervisor pattern** — it works well with clear agent descriptions and requires no training data. Add structured output for explicit intent tracking. Migrate to RAG when your dataset is ready.

---

## #12452 — Cannot Disable Memory with Runtime Context?

**Question:** Can memory be disabled dynamically using RuntimeContext per request?

**Answer:**

**Yes.** There are two approaches:

### 1. Function-Based Memory (Dynamic Instance)

Memory accepts a function that receives `requestContext`:

```typescript
const agent = new Agent({
  id: 'my-agent',
  instructions: 'You are helpful',
  model: 'openai/gpt-4',
  memory: ({ requestContext }) => {
    const disabled = requestContext.get('memoryDisabled');
    if (disabled) return undefined;  // No memory for this request
    return new Memory({ storage });
  },
});

// Usage: disable memory for a specific request
const ctx = new RuntimeContext();
ctx.set('memoryDisabled', true);
await agent.stream('Hello', { runtimeContext: ctx });
```

### 2. Per-Call Memory Options

Override memory config on each `stream()`/`generate()` call:

```typescript
const agent = new Agent({
  id: 'my-agent',
  instructions: 'You are helpful',
  model: 'openai/gpt-4',
  memory: new Memory({ storage }),
});

// Effectively disable memory for this call
await agent.stream('Hello', {
  memory: {
    thread: 'thread-id',
    resource: 'user-id',
    options: {
      lastMessages: false,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: false,
      readOnly: true,
    },
  },
});
```

### 3. Read-Only Mode

If you want the agent to *read* history but not *write*:

```typescript
await agent.stream('Hello', {
  memory: {
    thread: 'thread-id',
    resource: 'user-id',
    options: { readOnly: true },
  },
});
```

All `MemoryConfigInternal` options (`lastMessages`, `semanticRecall`, `workingMemory`, `observationalMemory`, `readOnly`, `generateTitle`) can be overridden per call.

---

## #13029 — Is there a way to know the cost of a built-in Scorer?

**Question:** Can I get input/output token usage metadata from built-in scorers (evals)?

**Answer:**

**Not directly from the scorer API today.** The `scorer.run()` result returns `score`, `reason`, and step results, but no `usage` or `cost` fields.

However, token usage IS captured in the observability layer. Here's how to access it:

### Workaround: Use Observability Tracing

Scorers that use LLM calls create `MODEL_GENERATION` spans with token usage attributes. Configure an exporter to capture them:

```typescript
import { Mastra } from '@mastra/core';
import { DefaultExporter } from '@mastra/core/observability';

const mastra = new Mastra({
  observability: {
    configs: {
      default: {
        serviceName: 'my-app',
        exporters: [new DefaultExporter({ strategy: 'insert-only' })],
      },
    },
  },
});
```

Then query span data from your storage for spans where `spanType === 'MODEL_GENERATION'` and the parent trace belongs to a scorer run. The span attributes include:

```typescript
interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  inputDetails?: { text?: number; cache?: number; audio?: number; image?: number };
  outputDetails?: { text?: number; reasoning?: number; audio?: number; image?: number };
}
```

### Quick Estimation

LLM-based scorers (like faithfulness, relevancy) typically make 2-3 LLM calls per evaluation:
1. **Preprocess** step — extracts claims/statements
2. **Analyze** step — evaluates each claim
3. **Score** step — produces final score + reason

Each step's prompt is available in the scorer result (`preprocessPrompt`, `analyzePrompt`, `generateScorePrompt`), so you can estimate tokens from prompt length.

### Feature Gap

This is a known limitation. The infrastructure for token tracking exists in the observability layer (`UsageStats`, `CostContext`) but isn't yet surfaced through the scorer API.

---

## #14658 — Output processors in a Supervisor agent architecture (streaming)

**Question:** Is there a way to programmatically modify the output result of a subagent before being injected to the supervisor agent?

**Answer:**

**Yes.** Use the `onDelegationComplete` hook in the delegation config:

```typescript
const supervisor = new Agent({
  id: 'supervisor',
  instructions: 'Coordinate specialist agents',
  model: 'openai/gpt-4',
  agents: { researchAgent, writerAgent },
});

const stream = await supervisor.stream(userMessage, {
  maxSteps: 10,
  delegation: {
    onDelegationComplete: (ctx) => {
      const rawResult = ctx.result.text;

      // Modify/summarize/filter the subagent's result
      // Return feedback that the supervisor sees instead
      return {
        feedback: `Summary of sub-agent result: ${summarize(rawResult)}`,
      };
    },
  },
});
```

The `feedback` string is injected into the supervisor's message stream and becomes context for its next LLM iteration.

### Other Interception Points

1. **`onDelegationStart`** — Modify the prompt before the subagent runs:
   ```typescript
   onDelegationStart: (ctx) => ({
     proceed: true,
     modifiedPrompt: `Focus only on: ${ctx.prompt}`,
   }),
   ```

2. **`messageFilter`** — Control which messages the subagent receives:
   ```typescript
   messageFilter: ({ messages, primitiveId }) => {
     return messages.filter(m => isRelevantTo(m, primitiveId));
   },
   ```

3. **Output processors on the subagent** — Attach `processOutputStream` to the subagent itself to transform chunks before they're returned:
   ```typescript
   const researchAgent = new Agent({
     id: 'research-agent',
     processors: [{
       processOutputStream: async ({ part }) => {
         // Transform individual stream chunks
         return modifiedPart;
       },
     }],
   });
   ```

---

## #13640 — Is there a way to modify user messages sent to LLM but NOT persist?

**Question:** Can I transform user messages for the LLM without storing the transformed version?

**Answer:**

**Yes.** Input processors modify messages for the LLM call only — the original messages are what get persisted to storage.

```typescript
const agent = new Agent({
  id: 'my-agent',
  instructions: 'You are helpful',
  model: 'openai/gpt-4',
  memory: new Memory({ storage }),
  processors: [
    {
      processInput: async ({ messages }) => {
        // This modification ONLY affects the LLM call
        // The original message is what gets saved to storage
        return messages.map(m => {
          if (m.role === 'user') {
            return {
              ...m,
              content: `[Context injected] ${m.content}`,
            };
          }
          return m;
        });
      },
    },
  ],
});
```

### How the Message Flow Works

1. User message is saved to storage (original)
2. `processInput()` runs and modifies messages for LLM
3. LLM receives the modified version
4. Response is saved to storage

The input processor sits between storage and the LLM — it transforms what the model sees without affecting what's persisted.

### Per-Step Processing

For modifications that should happen before each LLM step (in multi-step agent loops):

```typescript
processors: [
  {
    processInputStep: async ({ messages }) => {
      // Runs before EACH LLM call in a multi-step execution
      return messages.map(m => {
        if (m.role === 'user') {
          return { ...m, content: augmentWithContext(m.content) };
        }
        return m;
      });
    },
  },
],
```

---

## #13922 — Working Memory update blocking response stream — architecture question

**Question:** (1) Why are WM updates coupled to the agent's tool-calling loop? (2) Can `memory.updateWorkingMemory()` be called programmatically outside the loop? (3) How does `version: 'vnext'` work?

**Answer:**

### (1) Why WM Updates Are in the Tool Loop

Working memory updates are exposed as agent tools because:
- The LLM decides **what** to store based on conversation context
- The agent context provides `threadId`, `resourceId`, and memory references automatically
- The agent loop serializes tool execution, preventing concurrent write conflicts
- After a WM update, the agent refreshes the thread so subsequent steps see updated state

There is no mutex/locking beyond this serialization — the storage backend handles atomicity.

### (2) Yes, You Can Call It Programmatically

`memory.updateWorkingMemory()` is a public method:

```typescript
// After the agent stream completes, update WM asynchronously
const response = await agent.stream(userMessage, { /* ... */ });

// Separate, lightweight LLM call to generate WM update
const wmUpdate = await wmAgent.generate(
  `Given this conversation, update the working memory: ${conversationSummary}`,
  { structuredOutput: { schema: wmSchema } }
);

// Write directly — no agent loop needed
await memory.updateWorkingMemory({
  threadId: 'thread-123',
  resourceId: 'user-123',
  workingMemory: wmUpdate.object.content,
  memoryConfig: config,
});
```

**Caveats:**
- You must provide `threadId` and `resourceId` manually (the tool gets these from agent context)
- No automatic thread creation or validation
- No concurrent write protection outside the agent loop
- The approach you described (async WM update after response) is sound

### (3) `version: 'vnext'` — Incremental Mode

```typescript
memory: new Memory({
  options: {
    workingMemory: {
      enabled: true,
      template: myTemplate,
      version: 'vnext',  // Incremental mode
    },
  },
});
```

| Behavior | `stable` (default) | `vnext` |
|----------|-------------------|---------|
| Update frequency | Every response | Only when memory changed |
| Empty sections | Must include them | Can omit unchanged sections |
| Scope | Current conversation | Explicitly spans conversations |
| LLM instruction | "Always call updateWorkingMemory" | "Only call if memory changed" |

Both modes use full replacement under the hood — `vnext` changes the **LLM instructions** to be more selective about when to call the tool, which directly addresses your latency concern. With `vnext`, on turns where nothing changed, the model skips the WM update entirely.

**For your use case** (10KB template, large contexts), `vnext` combined with your proposed async-update approach should significantly reduce blocking.
