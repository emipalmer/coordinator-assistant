import { z } from 'zod';
import type { Logger } from '@app/core';
import type { Collections } from '../db.js';
import type { ToolDef, ToolOutcome } from '../llm.js';
import type { StoredFile } from '../files.js';

export interface ToolContext {
  c: Collections;
  log: Logger;
  now: Date;
  timezone: string;
  coordinator: string;
  /** Files queued here are sent as attachments after the text reply. */
  attachments: StoredFile[];
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolOutcome>;
}

export const defineTool = <S extends z.ZodType>(t: Tool<S>): Tool<S> => t;

export function toToolDefs(tools: Tool[]): ToolDef[] {
  return tools.map((t) => {
    // `io: 'input'` so fields with defaults show as optional to the model.
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

/** Every model-supplied input goes through zod before anything touches the database. */
export function createExecutor(tools: Tool[], ctx: ToolContext) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async (name: string, raw: unknown): Promise<ToolOutcome> => {
    const tool = byName.get(name);
    if (!tool) return { ok: false, content: `Unknown tool ${name}` };
    const parsed = tool.input.safeParse(raw ?? {});
    if (!parsed.success) {
      ctx.log.warn('tool input rejected', { tool: name, issues: parsed.error.issues });
      return { ok: false, content: `Invalid input: ${z.prettifyError(parsed.error)}` };
    }
    try {
      const out = await tool.run(ctx, parsed.data);
      ctx.log.info('tool ran', { tool: name, ok: out.ok });
      return out;
    } catch (err) {
      ctx.log.error('tool failed', { tool: name, err });
      return { ok: false, content: `Tool error: ${(err as Error).message}` };
    }
  };
}
