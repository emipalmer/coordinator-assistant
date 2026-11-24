import { randomUUID } from 'node:crypto';

// Thin client over the BlueBubbles server REST API (auth is the server password as a query param).
export function createBlueBubbles(baseUrl: string, password: string) {
  const url = (path: string) => `${baseUrl}${path}?password=${encodeURIComponent(password)}`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(url(path), {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: number; message?: string; data?: T };
    if (!res.ok || (json.status && json.status >= 400)) {
      throw new Error(`BlueBubbles ${method} ${path} failed: ${res.status} ${json.message ?? ''}`);
    }
    return json.data as T;
  }

  const exists = async (chatGuid: string) => {
    const res = await fetch(url(`/api/v1/chat/${encodeURIComponent(chatGuid)}`), { signal: AbortSignal.timeout(10_000) });
    return res.ok;
  };

  // Messages names 1:1 chats differently across macOS versions: "iMessage;-;<handle>" up to macOS 15,
  // "any;-;<handle>" from macOS 26 on. Ask BlueBubbles which one exists instead of guessing, and remember it.
  const guidCache = new Map<string, string>();
  async function chatGuidFor(handle: string): Promise<string> {
    const hit = guidCache.get(handle);
    if (hit) return hit;
    for (const prefix of CHAT_PREFIXES) {
      const guid = `${prefix};-;${handle}`;
      if (await exists(guid)) {
        guidCache.set(handle, guid);
        return guid;
      }
    }
    // No chat yet: use whatever prefix this Mac's existing chats use.
    const recent = await call<Array<{ guid: string }>>('POST', '/api/v1/chat/query', { limit: 1, offset: 0, with: [] }).catch(() => []);
    const prefix = recent[0]?.guid.split(';')[0] ?? 'any';
    return `${prefix};-;${handle}`;
  }

  return {
    chatGuidFor,
    /** Forget a cached chat id (after a failed send, in case Messages renamed it). */
    forgetChat: (handle: string) => guidCache.delete(handle),
    // Without the Private API, AppleScript is the only send method available.
    sendText: (chatGuid: string, message: string) =>
      call('POST', '/api/v1/message/text', { chatGuid, message, tempGuid: `temp-${randomUUID()}`, method: 'apple-script' }),
    /** Multipart upload; AppleScript sends need a tempGuid. */
    sendAttachment: async (chatGuid: string, filename: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) => {
      const form = new FormData();
      form.set('chatGuid', chatGuid);
      form.set('tempGuid', `temp-${randomUUID()}`);
      form.set('name', filename);
      form.set('method', 'apple-script');
      form.set('attachment', new Blob([bytes], { type: contentType }), filename);
      const res = await fetch(url('/api/v1/message/attachment'), { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
      const json = (await res.json().catch(() => ({}))) as { status?: number; message?: string };
      if (!res.ok || (json.status && json.status >= 400)) throw new Error(`BlueBubbles attachment failed: ${res.status} ${json.message ?? ''}`);
    },
    /** BlueBubbles converts HEIC to JPEG unless `original` is set; width keeps uploads small. */
    downloadAttachment: async (guid: string) => {
      const res = await fetch(`${url(`/api/v1/attachment/${encodeURIComponent(guid)}/download`)}&width=1600`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`attachment download ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
    },
    listWebhooks: () => call<Array<{ id: number; url: string; events: string[] }>>('GET', '/api/v1/webhook'),
    addWebhook: (webhookUrl: string, events: string[]) => call('POST', '/api/v1/webhook', { url: webhookUrl, events }),
    deleteWebhook: (id: number) => call('DELETE', `/api/v1/webhook/${id}`),
  };
}
export type BlueBubbles = ReturnType<typeof createBlueBubbles>;

const CHAT_PREFIXES = ['any', 'iMessage', 'SMS'] as const;
