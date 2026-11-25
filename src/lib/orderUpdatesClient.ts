/** Keep session credentials in request headers and read only invalidation signals from the stream. */
export function subscribeOrderChanges(
  open: (signal: AbortSignal) => Promise<Response>,
  onChange: () => void,
): () => void {
  const controller = new AbortController();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  const connect = async () => {
    try {
      const response = await open(controller.signal);
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status)) return;
        throw Error('Seguimiento temporalmente desconectado');
      }
      if (controller.signal.aborted) return;
      onChange(); // Covers updates between the initial snapshot and connecting, including reconnections.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop()!;
          if (frames.some(frame => frame === 'data: changed') && !controller.signal.aborted) onChange();
          if (frames.length) delay = 1000;
        }
      } finally { reader.releaseLock(); }
    } catch { /* The snapshot poll remains available while reconnecting. */ }
    if (!controller.signal.aborted) {
      retry = setTimeout(connect, delay);
      delay = Math.min(30_000, delay * 2);
    }
  };
  void connect();
  return () => { controller.abort(); clearTimeout(retry); };
}
