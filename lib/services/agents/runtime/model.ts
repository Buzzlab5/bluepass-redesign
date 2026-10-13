/**
 * The model port. All agent model calls go through here (Kai build brief,
 * invariant 5): one Anthropic adapter for production, one scripted adapter
 * for tests, and a single `executeTool` path that validates every tool
 * input against its schema before it runs, whichever adapter is in use.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  AgentTool,
  ModelPort,
  ModelRunParams,
  ModelRunResult,
  ModelTier,
  RunContext,
} from "./types";

/**
 * Strong model for judgement (quotes, exceptions, reconciliation), small
 * model for sorting (classification, triage). Override per environment.
 */
export const MODEL_IDS: Record<ModelTier, string> = {
  reasoning: process.env.AGENTS_MODEL_REASONING ?? "claude-opus-5",
  classification: process.env.AGENTS_MODEL_CLASSIFICATION ?? "claude-haiku-4-5",
};

type InputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
};

/** Zod → the flat JSON Schema shape the Messages API expects. */
export function toolInputSchema(schema: z.ZodTypeAny): InputSchema {
  const json = z.toJSONSchema(schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    type: "object",
    properties: json.properties ?? {},
    required: json.required ?? [],
  };
}

/**
 * Validate, run, and record one tool call. Never throws: the model gets a
 * readable error string and the failure is kept on the run's tool log.
 */
export async function executeTool(
  tool: AgentTool,
  rawInput: unknown,
  ctx: RunContext,
): Promise<string> {
  const started = Date.now();
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    const msg = `INVALID_INPUT for ${tool.name}: ${parsed.error.message}`;
    ctx.toolCalls.push({
      name: tool.name,
      input: rawInput,
      result: msg,
      ms: Date.now() - started,
      error: true,
    });
    return msg;
  }
  try {
    const result = await tool.run(parsed.data, ctx);
    ctx.toolCalls.push({
      name: tool.name,
      input: parsed.data,
      result: result.length > 4000 ? result.slice(0, 4000) + "…" : result,
      ms: Date.now() - started,
    });
    return result;
  } catch (err) {
    const msg = `TOOL_ERROR ${tool.name}: ${err instanceof Error ? err.message : String(err)}`;
    ctx.toolCalls.push({
      name: tool.name,
      input: parsed.data,
      result: msg,
      ms: Date.now() - started,
      error: true,
    });
    return msg;
  }
}

// ─── Anthropic adapter ───────────────────────────────────────────────────────

export class AnthropicModel implements ModelPort {
  private client: Anthropic | null = null;

  private get(): Anthropic {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          "ANTHROPIC_API_KEY not set — the agent runtime cannot call the model.",
        );
      }
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  async run(p: ModelRunParams): Promise<ModelRunResult> {
    // Tool order is deterministic (the definition's order) and the system
    // prompt is frozen per agent, so the cached prefix survives across runs.
    const runner = this.get().beta.messages.toolRunner({
      model: p.model,
      max_tokens: p.maxTokens,
      max_iterations: p.maxIterations,
      ...(p.thinking ? { thinking: { type: "adaptive" as const } } : {}),
      system: [
        {
          type: "text" as const,
          text: p.system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: p.user }],
      tools: p.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: toolInputSchema(t.schema),
        run: async (input: unknown) => executeTool(t, input, p.ctx),
      })),
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let last: Anthropic.Beta.Messages.BetaMessage | undefined;
    for await (const message of runner) {
      last = message;
      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;
      cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    }

    const text = (last?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();

    return {
      text,
      stopReason: last?.stop_reason ?? null,
      inputTokens,
      outputTokens,
      cacheReadTokens,
    };
  }
}

// ─── Scripted adapter (tests, dry runs) ──────────────────────────────────────

export type ScriptStep = { tool: string; input: unknown } | { text: string };

/**
 * Plays a fixed script of tool calls through the real tool wrappers. Lets a
 * test assert an agent's side effects without the API, and lets a dry run
 * prove the wiring on a staging database.
 */
export class ScriptedModel implements ModelPort {
  public calls: ModelRunParams[] = [];

  constructor(
    private script: ScriptStep[] | ((p: ModelRunParams) => ScriptStep[]),
  ) {}

  async run(p: ModelRunParams): Promise<ModelRunResult> {
    this.calls.push(p);
    const steps =
      typeof this.script === "function" ? this.script(p) : this.script;
    const texts: string[] = [];
    for (const step of steps) {
      if ("text" in step) {
        texts.push(step.text);
        continue;
      }
      const tool = p.tools.find((t) => t.name === step.tool);
      if (!tool) {
        throw new Error(
          `ScriptedModel: tool "${step.tool}" is not in the allow-list of agent "${p.ctx.agent.id}"`,
        );
      }
      await executeTool(tool, step.input, p.ctx);
    }
    return {
      text: texts.join("\n"),
      stopReason: "end_turn",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    };
  }
}

// ─── Port selection ──────────────────────────────────────────────────────────

let override: ModelPort | null = null;
let production: ModelPort | null = null;

export function getModelPort(): ModelPort {
  if (override) return override;
  if (!production) production = new AnthropicModel();
  return production;
}

/** Tests and dry runs swap the port; pass null to restore the default. */
export function setModelPort(port: ModelPort | null): void {
  override = port;
}
