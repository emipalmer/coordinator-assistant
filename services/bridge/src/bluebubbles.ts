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

  return {
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

/** 1:1 iMessage chats are addressed as iMessage;-;<handle>. */
export const directChatGuid = (e164: string) => `iMessage;-;${e164}`;
