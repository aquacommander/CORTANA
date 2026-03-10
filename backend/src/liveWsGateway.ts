import { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { LiveIntent } from '../../frontend/shared/contracts.ts';
import { transcribeAudioChunk } from './liveAudioService.ts';
import { synthesizeLiveReplyVoice } from './liveVoiceService.ts';

type ProcessMessageFn = (sessionId: string, message: string, screenshotBase64?: string) => Promise<{
  liveIntent: LiveIntent;
  reply: string;
}>;

type ResolveGoalFn = (sessionId: string) => string;
type StartRealtimeFn = (
  sessionId: string,
  goal: string,
) => Promise<{
  liveSessionId: string;
  mode?: string;
  model?: string;
  fallbackReason?: string;
}>;
type SendRealtimeFn = (
  liveSessionId: string,
  input: { message: string; screenshotBase64?: string },
) => Promise<string>;
type InterruptRealtimeFn = (liveSessionId: string) => Promise<void>;
type StopRealtimeFn = (liveSessionId: string) => Promise<void>;

type ClientState = {
  connectionId: string;
  remoteAddress: string;
  clientId?: string;
  sessionId?: string;
  latestScreenshotBase64?: string;
  bufferedAudioChunks: string[];
  bufferedAudioMimeType: string;
  bufferedAudioEncoding: string;
  bufferedAudioSampleRate?: number;
  bufferedAudioChunkSize?: number;
  audioListeningStarted: boolean;
  audioReceivedFrames: number;
  audioReceivedBytes: number;
  liveSessionId?: string;
  streamToken: number;
  turnQueue: Promise<void>;
};

function safeSend(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function logInfo(event: string, payload: Record<string, unknown>) {
  console.log(`[${new Date().toISOString()}] [INFO] ${event} ${JSON.stringify(payload)}`);
}

function shouldUseRealtimeReply(reply?: string): boolean {
  if (!reply) return false;
  const lower = reply.toLowerCase();
  if (lower.startsWith('realtime mode is available. i received:')) {
    return false;
  }
  return true;
}

function isInterruptedError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('interrupted');
}

async function streamReply(socket: WebSocket, token: number, state: ClientState, reply: string) {
  const words = reply.split(/\s+/).filter(Boolean);
  let aggregate = '';
  for (let i = 0; i < words.length; i += 1) {
    if (state.streamToken !== token) {
      safeSend(socket, { type: 'interrupted' });
      return undefined;
    }
    const chunk = `${words[i]}${i < words.length - 1 ? ' ' : ''}`;
    aggregate += chunk;
    safeSend(socket, { type: 'delta', delta: chunk });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return aggregate;
}

function stripBase64Prefix(value: string): string {
  return value.replace(/^data:.*;base64,/, '');
}

function mergeAudioChunks(chunks: string[]): string | undefined {
  if (chunks.length === 0) return undefined;
  if (chunks.length === 1) return stripBase64Prefix(chunks[0]);
  const buffers = chunks.map((chunk) => Buffer.from(stripBase64Prefix(chunk), 'base64'));
  return Buffer.concat(buffers).toString('base64');
}

async function enqueueTurn(state: ClientState, task: () => Promise<void>): Promise<void> {
  state.turnQueue = state.turnQueue.catch(() => undefined).then(task);
  return state.turnQueue;
}

async function streamVoiceOutput(socket: WebSocket, state: ClientState, token: number, replyText: string) {
  const audio = await synthesizeLiveReplyVoice(replyText);
  if (!audio?.audioBase64) return;
  if (state.streamToken !== token) return;
  const streamId = randomUUID();
  safeSend(socket, {
    type: 'audio_output_start',
    streamId,
    mimeType: audio.mimeType,
    provider: audio.provider,
  });
  const chunkSize = 12_000;
  for (let i = 0; i < audio.audioBase64.length; i += chunkSize) {
    if (state.streamToken !== token) {
      safeSend(socket, { type: 'audio_output_end', streamId, interrupted: true });
      return;
    }
    safeSend(socket, {
      type: 'audio_output_frame',
      streamId,
      data: audio.audioBase64.slice(i, i + chunkSize),
      seq: Math.floor(i / chunkSize),
    });
  }
  safeSend(socket, { type: 'audio_output_end', streamId, interrupted: false });
}

export function attachLiveWsGateway(params: {
  wss: WebSocketServer;
  processMessage: ProcessMessageFn;
  resolveGoal: ResolveGoalFn;
  startRealtime: StartRealtimeFn;
  sendRealtime: SendRealtimeFn;
  interruptRealtime: InterruptRealtimeFn;
  stopRealtime: StopRealtimeFn;
}) {
  params.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const url = req.url || '';
    if (!url.startsWith('/api/live/ws') && !url.startsWith('/ws')) {
      socket.close();
      return;
    }

    const state: ClientState = {
      connectionId: randomUUID(),
      remoteAddress: String(req.socket.remoteAddress || 'unknown'),
      streamToken: 0,
      bufferedAudioChunks: [],
      bufferedAudioMimeType: 'audio/webm',
      bufferedAudioEncoding: 'unknown',
      audioListeningStarted: false,
      audioReceivedFrames: 0,
      audioReceivedBytes: 0,
      turnQueue: Promise.resolve(),
    };
    logInfo('ws.connection.opened', {
      connectionId: state.connectionId,
      remoteAddress: state.remoteAddress,
    });
    safeSend(socket, { type: 'ready' });

    const interruptActiveTurn = async (notifyClient: boolean) => {
      state.streamToken += 1;
      if (state.liveSessionId) {
        await params.interruptRealtime(state.liveSessionId).catch(() => undefined);
      }
      if (notifyClient) {
        safeSend(socket, { type: 'interrupted' });
      }
    };

    const runUnifiedTurn = async (input: {
      source: 'text' | 'audio';
      message: string;
      screenshotBase64?: string;
      stream?: boolean;
      bargeIn?: boolean;
    }) => {
      if (!state.sessionId) {
        safeSend(socket, { type: 'error', error: 'start_session must be sent first' });
        return;
      }
      if (input.bargeIn) {
        await interruptActiveTurn(false);
      }
      await enqueueTurn(state, async () => {
        const token = state.streamToken + 1;
        state.streamToken = token;
        safeSend(socket, { type: 'turn_started', source: input.source });

        try {
          const realtimeReply = state.liveSessionId
            ? await params.sendRealtime(state.liveSessionId, {
                message: input.message,
                screenshotBase64: input.screenshotBase64,
              })
            : undefined;
          const result = await params.processMessage(
            state.sessionId!,
            input.message,
            input.screenshotBase64,
          );
          const finalReply = shouldUseRealtimeReply(realtimeReply) ? realtimeReply! : result.reply;
          safeSend(socket, { type: 'intent_update', liveIntent: result.liveIntent });

          if (input.stream) {
            const aggregate = await streamReply(socket, token, state, finalReply);
            if (!aggregate) return;
            safeSend(socket, {
              type: 'final',
              source: input.source,
              reply: aggregate,
              liveIntent: result.liveIntent,
            });
            void streamVoiceOutput(socket, state, token, aggregate);
            return;
          }

          safeSend(socket, {
            type: 'final',
            source: input.source,
            reply: finalReply,
            liveIntent: result.liveIntent,
          });
          void streamVoiceOutput(socket, state, token, finalReply);
        } catch (error: any) {
          if (isInterruptedError(error)) {
            safeSend(socket, { type: 'interrupted' });
            return;
          }
          safeSend(socket, {
            type: 'error',
            error: error?.message || 'Unable to process live turn',
          });
        }
      });
    };

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
          let liveMeta: { mode?: string; model?: string; fallbackReason?: string } = {};
          if (state.liveSessionId && state.sessionId && state.sessionId !== sessionId) {
            await params.stopRealtime(state.liveSessionId).catch(() => undefined);
            state.liveSessionId = undefined;
          }
          state.sessionId = sessionId;
          if (!state.liveSessionId) {
            const live = await params.startRealtime(sessionId, goal);
            state.liveSessionId = live.liveSessionId;
            liveMeta = {
              mode: live.mode,
              model: live.model,
              fallbackReason: live.fallbackReason,
            };
            logInfo('gemini.session.ready', {
              connectionId: state.connectionId,
              model: live.model || 'unknown',
            });
          }
          safeSend(socket, {
            type: 'session_started',
            sessionId,
            goal,
            mode: liveMeta.mode,
            model: liveMeta.model,
            fallbackReason: liveMeta.fallbackReason,
          });
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

      if (type === 'hello') {
        const clientId = String(data?.clientId || '').trim();
        if (!clientId) {
          safeSend(socket, { type: 'error', error: 'clientId is required for hello' });
          return;
        }
        state.clientId = clientId;
        logInfo('ws.client.hello', {
          connectionId: state.connectionId,
          clientId,
        });
        safeSend(socket, { type: 'hello_ack', clientId, connectionId: state.connectionId });
        return;
      }

      if (type === 'interrupt') {
        await interruptActiveTurn(true);
        return;
      }

      if (type === 'user_message') {
        const message = String(data?.message || '').trim();
        if (!message) {
          safeSend(socket, { type: 'error', error: 'message is required' });
          return;
        }
        const screenshotBase64 =
          String(data?.screenshotBase64 || '').trim() || state.latestScreenshotBase64;
        logInfo('gemini.text.prompt', {
          connectionId: state.connectionId,
          requestId: randomUUID(),
        });
        await runUnifiedTurn({
          source: 'text',
          message,
          screenshotBase64,
          stream: true,
          bargeIn: true,
        });
        return;
      }

      if (type === 'audio_chunk') {
        const chunkData = String(data?.data || '').trim();
        const mimeType = String(data?.mimeType || 'audio/webm').trim();
        const sampleRateValue = Number(data?.sampleRate || 0);
        const chunkSizeValue = Number(data?.chunkSize || 0);
        const sampleRate = Number.isFinite(sampleRateValue) && sampleRateValue > 0 ? sampleRateValue : undefined;
        const chunkSize = Number.isFinite(chunkSizeValue) && chunkSizeValue > 0 ? chunkSizeValue : undefined;
        const encoding = String(data?.encoding || 'unknown');
        if (!chunkData) {
          safeSend(socket, { type: 'error', error: 'audio_chunk.data is required' });
          return;
        }
        state.bufferedAudioMimeType = mimeType || state.bufferedAudioMimeType;
        state.bufferedAudioEncoding = encoding || state.bufferedAudioEncoding;
        state.bufferedAudioSampleRate = sampleRate || state.bufferedAudioSampleRate;
        state.bufferedAudioChunkSize = chunkSize || state.bufferedAudioChunkSize;
        state.bufferedAudioChunks.push(chunkData);
        if (state.bufferedAudioChunks.length > 24) {
          state.bufferedAudioChunks = state.bufferedAudioChunks.slice(-24);
        }
        const chunkBytes = Buffer.from(stripBase64Prefix(chunkData), 'base64').length;
        state.audioReceivedFrames += 1;
        state.audioReceivedBytes += chunkBytes;
        if (!state.audioListeningStarted) {
          state.audioListeningStarted = true;
          logInfo('audio.listening.started', {
            connectionId: state.connectionId,
            sampleRate: state.bufferedAudioSampleRate ?? null,
            chunkSize: state.bufferedAudioChunkSize ?? null,
            encoding: state.bufferedAudioEncoding,
            mimeType: state.bufferedAudioMimeType,
          });
        }
        if (state.audioReceivedFrames % 25 === 0) {
          logInfo('audio.mic.progress', {
            connectionId: state.connectionId,
            receivedFrames: state.audioReceivedFrames,
            receivedBytes: state.audioReceivedBytes,
          });
        }
        safeSend(socket, { type: 'audio_ack', bufferedChunks: state.bufferedAudioChunks.length });
        return;
      }

      if (type === 'audio_commit') {
        if (!state.sessionId) {
          safeSend(socket, { type: 'error', error: 'start_session must be sent first' });
          return;
        }
        const mergedAudio = mergeAudioChunks(state.bufferedAudioChunks);
        if (!mergedAudio) {
          safeSend(socket, { type: 'error', error: 'No audio chunk available to commit' });
          return;
        }
        const transcript =
          (await transcribeAudioChunk({
            audioBase64: mergedAudio,
            mimeType: state.bufferedAudioMimeType,
            goal: params.resolveGoal(state.sessionId),
          })) || '';
        state.bufferedAudioChunks = [];
        if (!transcript) {
          safeSend(socket, {
            type: 'error',
            error: 'Audio transcription failed. Please speak again or use text input.',
          });
          return;
        }
        safeSend(socket, { type: 'transcript', transcript });
        logInfo('gemini.text.prompt', {
          connectionId: state.connectionId,
          requestId: randomUUID(),
        });
        await runUnifiedTurn({
          source: 'audio',
          message: transcript,
          screenshotBase64: state.latestScreenshotBase64,
          stream: false,
          bargeIn: true,
        });
        return;
      }

      safeSend(socket, { type: 'error', error: `Unsupported message type: ${type || 'unknown'}` });
    });

    socket.on('close', () => {
      state.bufferedAudioChunks = [];
      logInfo('ws.connection.closed', {
        connectionId: state.connectionId,
        clientId: state.clientId || null,
        receivedFrames: state.audioReceivedFrames,
        receivedBytes: state.audioReceivedBytes,
      });
      if (state.liveSessionId) {
        params.stopRealtime(state.liveSessionId).catch(() => undefined);
      }
    });
  });
}
