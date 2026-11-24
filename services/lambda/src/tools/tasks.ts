import { z } from 'zod';
import { getConnection, googleApi, TASKS_SCOPE } from '../google.js';
import { defineTool, type ToolContext } from './registry.js';
import { withGoogle } from './google.js';

const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ListId = z.string().min(1).max(200).default('@default');

interface GTask { id: string; title?: string; notes?: string; due?: string; status: 'needsAction' | 'completed'; completed?: string; parent?: string; webViewLink?: string }

/** Tasks needs its own permission; people who connected before it existed have to reconnect once. */
async function withTasks(ctx: ToolContext, fn: () => Promise<unknown>) {
  const conn = await getConnection(ctx.c, ctx.owner);
  if (conn && !conn.scopes.includes(TASKS_SCOPE)) {
    return { ok: false, content: 'Google Tasks permission is missing (Google was connected before Tasks was added, or the box was unticked). Offer a fresh connect_google link.' };
  }
  return withGoogle(fn);
}

const taskUrl = (list: string, task?: string) => `${TASKS}/lists/${encodeURIComponent(list)}/tasks${task ? `/${encodeURIComponent(task)}` : ''}`;
// Google Tasks stores only a date; it expects midnight UTC on that date.
const dueValue = (day: string) => `${day}T00:00:00.000Z`;
const show = (t: GTask) => ({ id: t.id, title: t.title ?? '(untitled)', ...(t.due && { due: t.due.slice(0, 10) }), ...(t.notes && { notes: t.notes.slice(0, 300) }), ...(t.status === 'completed' && { done: true }), ...(t.parent && { subtaskOf: t.parent }) });

export const listTasks = defineTool({
  name: 'list_tasks',
  description: "The owner's Google Tasks to-do items (open ones by default), with ids. Also returns their task lists. Due dates are dates only.",
  input: z.object({ listId: ListId, includeDone: z.boolean().default(false) }),
  async run(ctx, input) {
    return withTasks(ctx, async () => {
      const [lists, tasks] = await Promise.all([
        googleApi<{ items?: Array<{ id: string; title: string }> }>(ctx.c, ctx.owner, 'GET', `${TASKS}/users/@me/lists?maxResults=100`),
        googleApi<{ items?: GTask[] }>(ctx.c, ctx.owner, 'GET', `${taskUrl(input.listId)}?${new URLSearchParams({ showCompleted: String(input.includeDone), showHidden: String(input.includeDone), maxResults: '100' })}`),
      ]);
      const items = (tasks.items ?? []).map(show).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
      return { lists: (lists.items ?? []).map((l) => ({ id: l.id, name: l.title })), tasks: items };
    });
  },
});

export const addTask = defineTool({
  name: 'add_task',
  description: 'Add a to-do to Google Tasks (shows up in the Tasks app and in Google Calendar on its due date). For "text me at 9" use set_reminder instead.',
  input: z.object({ title: z.string().min(1).max(500), notes: z.string().max(4000).optional(), due: LocalDay.optional(), listId: ListId }),
  async run(ctx, input) {
    return withTasks(ctx, async () => {
      const t = await googleApi<GTask>(ctx.c, ctx.owner, 'POST', taskUrl(input.listId), { title: input.title, notes: input.notes, ...(input.due && { due: dueValue(input.due) }) });
      return { added: show(t) };
    });
  },
});

export const updateTask = defineTool({
  name: 'update_task',
  description: 'Change a task (title, notes, due date) or mark it done / not done. Get the id from list_tasks.',
  input: z.object({
    taskId: z.string().min(1).max(200),
    listId: ListId,
    title: z.string().min(1).max(500).optional(),
    notes: z.string().max(4000).optional(),
    due: LocalDay.nullable().optional().describe('null clears the due date'),
    done: z.boolean().optional(),
  }),
  async run(ctx, input) {
    return withTasks(ctx, async () => {
      const patch: Record<string, unknown> = {};
      if (input.title) patch.title = input.title;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.due !== undefined) patch.due = input.due === null ? null : dueValue(input.due);
      if (input.done !== undefined) patch.status = input.done ? 'completed' : 'needsAction';
      if (input.done === false) patch.completed = null;
      const t = await googleApi<GTask>(ctx.c, ctx.owner, 'PATCH', taskUrl(input.listId, input.taskId), patch);
      return { updated: show(t) };
    });
  },
});

export const deleteTask = defineTool({
  name: 'delete_task',
  description: 'Delete a task entirely. Prefer update_task done=true when they finished it; delete only when they ask to remove it.',
  input: z.object({ taskId: z.string().min(1).max(200), listId: ListId }),
  async run(ctx, input) {
    return withTasks(ctx, async () => {
      await googleApi(ctx.c, ctx.owner, 'DELETE', taskUrl(input.listId, input.taskId));
      return { deleted: true };
    });
  },
});

export const TASK_TOOLS = [listTasks, addTask, updateTask, deleteTask];
