import Anthropic from '@anthropic-ai/sdk';
import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type Message } from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '@app/core';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface ToolOutcome {
  ok: boolean;
  content: string;
}
export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}
export interface LoopInput {
  system: string;
  history: Turn[];
  user: string;
  tools: ToolDef[];
  execute: (name: string, input: unknown) => Promise<ToolOutcome>;
  log: Logger;
}

const MAX_STEPS = 12;
const REFUSAL_REPLY = "Sorry, I can't help with that one.";

/**
 * Each provider runs the whole tool loop in its native message format, so provider-specific
 * blocks (thinking, reasoning) round-trip untouched. Only final text is persisted between turns.
 */
export type ToolLoop = (input: LoopInput) => Promise<string>;

export function createToolLoop(provider: string, opts: { model: string; anthropicKey?: string }): ToolLoop {
  if (provider === 'anthropic') return anthropicLoop(opts.model, opts.anthropicKey);
  return bedrockLoop(opts.model);
}

function bedrockLoop(modelId: string): ToolLoop {
  const client = new BedrockRuntimeClient({});
  return async ({ system, history, user, tools, execute, log }) => {
    const messages: Message[] = [...history, { role: 'user' as const, text: user }].map((t) => ({
      role: t.role,
      content: [{ text: t.text }],
    }));
    const toolConfig = {
      tools: [
        ...tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } } })),
        { cachePoint: { type: 'default' as const } },
      ],
    };
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: system }, { cachePoint: { type: 'default' } }],
          messages,
          toolConfig,
          inferenceConfig: { maxTokens: 8000 },
        }),
      );
      const msg = res.output?.message;
      if (!msg) throw new Error('Converse returned no message');
      messages.push(msg);
      log.info('llm step', { provider: 'bedrock', step, stopReason: res.stopReason, usage: res.usage });

      if (res.stopReason === 'tool_use') {
        const results: ContentBlock[] = [];
        for (const block of msg.content ?? []) {
          if (!block.toolUse) continue;
          const out = await execute(block.toolUse.name!, block.toolUse.input);
          results.push({
            toolResult: { toolUseId: block.toolUse.toolUseId!, content: [{ text: out.content }], status: out.ok ? 'success' : 'error' },
          });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      if (res.stopReason === 'guardrail_intervened' || res.stopReason === 'content_filtered') return REFUSAL_REPLY;
      return textOf(msg.content?.map((b) => b.text ?? '') ?? []);
    }
    return "That took more steps than I expected. Can you try breaking it into smaller requests?";
  };
}

function anthropicLoop(model: string, apiKey: string | undefined): ToolLoop {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
  const client = new Anthropic({ apiKey });
  return async ({ system, history, user, tools, execute, log }) => {
    const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'user' as const, text: user }].map((t) => ({
      role: t.role,
      content: t.text,
    }));
    const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema }));
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        messages,
        tools: apiTools,
        // A text thread doesn't need deep deliberation; medium keeps replies quick without hurting tool use.
        output_config: { effort: (process.env.LLM_EFFORT as 'low' | 'medium' | 'high') ?? 'medium' },
        // Tools + system prompt are identical across turns, so cache them.
        cache_control: { type: 'ephemeral' },
        // Route policy declines to a fallback model instead of dead-ending the coordinator.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      messages.push({ role: 'assistant', content: res.content });
      log.info('llm step', { provider: 'anthropic', step, stopReason: res.stop_reason, usage: res.usage });

      if (res.stop_reason === 'refusal') return REFUSAL_REPLY;
      if (res.stop_reason === 'tool_use') {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of res.content) {
          if (block.type !== 'tool_use') continue;
          const out = await execute(block.name, block.input);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out.content, is_error: !out.ok });
        }
        // All results in one user message so parallel tool calls keep working.
        messages.push({ role: 'user', content: results });
        continue;
      }
      return textOf(res.content.map((b) => (b.type === 'text' ? b.text : '')));
    }
    return "That took more steps than I expected. Can you try breaking it into smaller requests?";
  };
}

const textOf = (parts: string[]) => parts.join('').trim() || 'Done.';
