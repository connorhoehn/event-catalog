/** Explicit broker wire response, reusable by fetch spies across multiple calls. */
export function queueResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300, status, headers: new Headers(headers),
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => body,
  } as Response;
}
