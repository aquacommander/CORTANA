import { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { LiveIntent } from '../../frontend/shared/contracts.ts';

type ProcessMessageFn = (sessionId: string, message: string, screenshotBase64?: string) => Promise<{
  liveIntent: LiveIntent;
  reply: string;
}>;

type ResolveGoalFn = (sessionId: string) => string;

type ClientState = {
  socket: WebSocket;
  sessionId?: string;
  latestScreenshotBase64?: string;
  streamToken: number;
};

function safeSend(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

export function attachLiveWsGateway(params: {
  wss: WebSocketServer;
  processMessage: ProcessMessageFn;
  resolveGoal: ResolveGoalFn;
}) {
  const clients = new Map<WebSocket, ClientState>();

  params.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const url = req.url || '';
    if (!url.startsWith('/api/live/ws')) {
      socket.close();
      return;
    }

    const state: ClientState = {
      socket,
      streamToken: 0,
    };
    clients.set(socket, state);
    safeSend(socket, { type: 'ready' });

    socket.on('message', async (raw) => {
      let data: any;
      try {
        data = JSON.parse(String(raw || '{}'));
      } catch {
        safeSend(socket, { type: 'error', error: 'Invalid JSON payload' });
        return;
      }

      const type = String(data?.type || '').trim();

      if (type === 'start_session') {
        const sessionId = String(data?.sessionId || '').trim();
        if (!sessionId) {
          safeSend(socket, { type: 'error', error: 'sessionId is required' });
          return;
        }
        try {
          const goal = params.resolveGoal(sessionId);
          state.sessionId = sessionId;
          safeSend(socket, { type: 'session_started', sessionId, goal });
        } catch (error: any) {
          safeSend(socket, { type: 'error', error: error?.message || 'Failed to start session' });
        }
        return;
      }

      if (type === 'vision_frame') {
        const screenshotBase64 = String(data?.screenshotBase64 || '').trim();
        if (!screenshotBase64) {
          safeSend(socket, { type: 'error', error: 'screenshotBase64 is required for vision_frame' });
          return;
        }
        state.latestScreenshotBase64 = screenshotBase64;
        safeSend(socket, { type: 'vision_ack' });
        return;
      }

      if (type === 'interrupt') {
        state.streamToken += 1;
        safeSend(socket, { type: 'interrupted' });
        return;
      }

      if (type === 'user_message') {
        if (!state.sessionId) {
          safeSend(socket, { type: 'error', error: 'start_session must be sent first' });
          return;
        }
        const message = String(data?.message || '').trim();
        if (!message) {
          safeSend(socket, { type: 'error', error: 'message is required' });
          return;
        }

        const token = state.streamToken + 1;
        state.streamToken = token;
        const screenshotBase64 =
          String(data?.screenshotBase64 || '').trim() || state.latestScreenshotBase64;

        try {
          const result = await params.processMessage(state.sessionId, message, screenshotBase64);
          safeSend(socket, { type: 'intent_update', liveIntent: result.liveIntent });
          const words = result.reply.split(/\s+/).filter(Boolean);
          let aggregate = '';
          for (let i = 0; i < words.length; i += 1) {
            if (state.streamToken !== token) {
              safeSend(socket, { type: 'interrupted' });
              return;
            }
            const chunk = `${words[i]}${i < words.length - 1 ? ' ' : ''}`;
            aggregate += chunk;
            safeSend(socket, { type: 'delta', delta: chunk });
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          safeSend(socket, {
            type: 'final',
            reply: aggregate || result.reply,
            liveIntent: result.liveIntent,
          });
        } catch (error: any) {
          safeSend(socket, {
            type: 'error',
            error: error?.message || 'Unable to process user_message',
          });
        }
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
    });
  });
}
