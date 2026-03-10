import { LiveIntent } from '../shared/contracts';

type LiveWsEvent =
  | { type: 'ready' }
  | {
      type: 'session_started';
      sessionId: string;
      goal: string;
      mode?: string;
      model?: string;
      fallbackReason?: string;
    }
  | { type: 'vision_ack' }
  | { type: 'audio_ack'; bufferedChunks?: number }
  | { type: 'audio_output_start'; streamId: string; mimeType?: string; provider?: string }
  | { type: 'audio_output_frame'; streamId: string; data: string; seq?: number }
  | { type: 'audio_output_end'; streamId: string; interrupted?: boolean }
  | { type: 'transcript'; transcript: string }
  | { type: 'turn_started'; source?: 'text' | 'audio' }
  | { type: 'intent_update'; liveIntent: LiveIntent }
  | { type: 'delta'; delta: string; source?: 'text' | 'audio' }
  | { type: 'final'; reply: string; liveIntent: LiveIntent; source?: 'text' | 'audio' }
  | { type: 'interrupted' }
  | { type: 'error'; error: string };

type MessageResult = { reply: string; liveIntent: LiveIntent };

export class LiveWsClient {
  private socket: WebSocket | null = null;
  private currentSessionId: string | null = null;
  private sessionStartWaiter: { resolve: () => void; reject: (reason?: unknown) => void } | null = null;
  private pending:
    | {
        resolve: (value: MessageResult) => void;
        reject: (reason?: unknown) => void;
        aggregate: string;
        onDelta?: (chunk: string, aggregate: string) => void;
      }
    | null = null;
  private listeners = new Set<(event: LiveWsEvent) => void>();

  constructor(private readonly wsBase: string) {}

  async connect(sessionId: string): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      if (this.currentSessionId === sessionId) return;
      await new Promise<void>((resolve, reject) => {
        this.sessionStartWaiter = { resolve, reject };
        this.socket!.send(JSON.stringify({ type: 'start_session', sessionId }));
      });
      this.currentSessionId = sessionId;
      return;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore close errors
      }
      this.socket = null;
    }

    const socket = new WebSocket(`${this.wsBase}/api/live/ws`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'start_session', sessionId }));
      };
      socket.onerror = () => reject(new Error('WebSocket connection failed'));
      socket.onclose = () => {
        if (this.sessionStartWaiter) {
          this.sessionStartWaiter.reject(new Error('WebSocket closed before session start'));
          this.sessionStartWaiter = null;
        }
        if (this.pending) {
          this.pending.reject(new Error('WebSocket closed'));
          this.pending = null;
        }
        this.currentSessionId = null;
      };
      socket.onmessage = (event) => {
        const payload = this.parseEvent(event.data);
        if (!payload) return;
        if (payload.type === 'session_started') {
          this.currentSessionId = payload.sessionId;
          if (this.sessionStartWaiter) {
            this.sessionStartWaiter.resolve();
            this.sessionStartWaiter = null;
          }
          resolve();
        }
        if (payload.type === 'error' && this.sessionStartWaiter) {
          this.sessionStartWaiter.reject(new Error(payload.error));
          this.sessionStartWaiter = null;
        }
        this.listeners.forEach((listener) => listener(payload));
        this.handleEvent(payload);
      };
    });
  }

  onEvent(listener: (event: LiveWsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  sendVisionFrame(screenshotBase64: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'vision_frame', screenshotBase64 }));
  }

  sendAudioChunk(data: string, mimeType: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'audio_chunk', data, mimeType }));
  }

  commitAudio() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'audio_commit' }));
  }

  sendMessage(message: string, options?: { screenshotBase64?: string; onDelta?: (chunk: string, aggregate: string) => void }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }
    if (this.pending) {
      return Promise.reject(new Error('A live message is already in progress'));
    }
    return new Promise<MessageResult>((resolve, reject) => {
      this.pending = { resolve, reject, aggregate: '', onDelta: options?.onDelta };
      this.socket!.send(
        JSON.stringify({
          type: 'user_message',
          message,
          screenshotBase64: options?.screenshotBase64,
        }),
      );
    });
  }

  interrupt() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'interrupt' }));
    if (this.pending) {
      this.pending.reject(new Error('Interrupted'));
      this.pending = null;
    }
  }

  close() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      // ignore
    }
    this.socket = null;
    this.pending = null;
    this.currentSessionId = null;
    this.sessionStartWaiter = null;
  }

  private parseEvent(raw: unknown): LiveWsEvent | null {
    try {
      const parsed = JSON.parse(String(raw || '{}'));
      return parsed as LiveWsEvent;
    } catch {
      return null;
    }
  }

  private handleEvent(event: LiveWsEvent) {
    if (!this.pending) return;
    if (event.type === 'delta') {
      this.pending.aggregate += event.delta;
      this.pending.onDelta?.(event.delta, this.pending.aggregate);
      return;
    }
    if (event.type === 'final') {
      this.pending.resolve({ reply: event.reply, liveIntent: event.liveIntent });
      this.pending = null;
      return;
    }
    if (event.type === 'error') {
      this.pending.reject(new Error(event.error));
      this.pending = null;
      return;
    }
    if (event.type === 'interrupted') {
      this.pending.reject(new Error('Interrupted'));
      this.pending = null;
    }
  }
}
