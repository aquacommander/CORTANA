import { randomUUID } from 'node:crypto';
import { type RawData, type WebSocket, type WebSocketServer } from 'ws';
import { GeminiLiveBridge } from './geminiLiveBridge.js';
import { log } from './liveNativeLogger.js';
import {
  AUDIO_ENCODING,
  CLIENT_AUDIO_FRAME_TYPE,
  SERVER_AUDIO_FRAME_TYPE,
} from './liveNativeProtocol.js';

type NativeGatewayParams = {
  wss: WebSocketServer;
  geminiApiKey: string;
  useVertex: boolean;
  vertexProject: string;
  vertexLocation: string;
  geminiModel: string;
  geminiSystemInstruction: string;
};

type ClientToServerMessage =
  | {
      type: 'client_hello';
      clientId: string;
      timestamp: string;
    }
  | {
      type: 'ping';
      requestId: string;
      timestamp: string;
    }
  | {
      type: 'start_listening';
      sampleRate: number;
      chunkSize: number;
      encoding: typeof AUDIO_ENCODING;
      timestamp: string;
    }
  | {
      type: 'stop_listening';
      timestamp: string;
    }
  | {
      type: 'send_text_prompt';
      requestId: string;
      text: string;
      timestamp: string;
    }
  | {
      type: 'barge_in';
      requestId: string;
      energy: number;
      timestamp: string;
    }
  | {
      type: 'send_snapshot_prompt';
      requestId: string;
      question: string;
      mimeType: 'image/jpeg' | 'image/png';
      imageBase64: string;
      timestamp: string;
    };

type ServerToClientMessage =
  | {
      type: 'server_hello';
      connectionId: string;
      timestamp: string;
      message: string;
    }
  | {
      type: 'pong';
      requestId: string;
      timestamp: string;
    }
  | {
      type: 'binary_stub_received';
      byteLength: number;
      timestamp: string;
    }
  | {
      type: 'listening_ack';
      sampleRate: number;
      chunkSize: number;
      encoding: typeof AUDIO_ENCODING;
      timestamp: string;
    }
  | {
      type: 'gemini_session_ready';
      model: string;
      timestamp: string;
    }
  | {
      type: 'gemini_text';
      text: string;
      timestamp: string;
    }
  | {
      type: 'gemini_turn_complete';
      timestamp: string;
    }
  | {
      type: 'model_interrupted';
      timestamp: string;
    }
  | {
      type: 'gemini_error';
      message: string;
      timestamp: string;
    }
  | {
      type: 'snapshot_received';
      requestId: string;
      mimeType: string;
      imageBytes: number;
      timestamp: string;
    }
  | {
      type: 'error';
      code: 'INVALID_JSON' | 'UNKNOWN_MESSAGE' | 'INVALID_BINARY_FRAME';
      message: string;
      timestamp: string;
    };

type ConnectionState = {
  listening: boolean;
  receivedAudioFrames: number;
  receivedAudioBytes: number;
  inputSampleRate: number;
  gemini: GeminiLiveBridge | null;
  geminiReady: boolean;
  suppressMicForwarding: boolean;
  suppressNextCloseError: boolean;
};

function sendJson(socket: WebSocket, message: ServerToClientMessage): void {
  socket.send(JSON.stringify(message));
}

function sendFramedBinary(socket: WebSocket, frameType: number, payload: Buffer): void {
  const outbound = Buffer.alloc(1 + payload.length);
  outbound.writeUInt8(frameType, 0);
  payload.copy(outbound, 1);
  socket.send(outbound, { binary: true });
}

function getBase64ByteLength(base64: string): number {
  try {
    return Buffer.from(base64, 'base64').byteLength;
  } catch {
    return 0;
  }
}

function cleanupGemini(state: ConnectionState): void {
  state.gemini?.close();
  state.gemini = null;
  state.geminiReady = false;
}

export function attachLiveNativeGateway(params: NativeGatewayParams): void {
  params.wss.on('connection', (socket, request) => {
    const connectionId = randomUUID();
    const connectedAt = new Date().toISOString();
    const state: ConnectionState = {
      listening: false,
      receivedAudioFrames: 0,
      receivedAudioBytes: 0,
      inputSampleRate: 16_000,
      gemini: null,
      geminiReady: false,
      suppressMicForwarding: false,
      suppressNextCloseError: false,
    };

    log('INFO', 'ws.native.connection.opened', {
      connectionId,
      remoteAddress: request.socket.remoteAddress,
    });

    sendJson(socket, {
      type: 'server_hello',
      connectionId,
      timestamp: connectedAt,
      message: 'Native LiveAgent WebSocket connected',
    });

    if (!params.useVertex && !params.geminiApiKey) {
      sendJson(socket, {
        type: 'gemini_error',
        message: 'Missing GEMINI_API_KEY in backend environment',
        timestamp: new Date().toISOString(),
      });
    } else if (params.useVertex && !params.vertexProject) {
      sendJson(socket, {
        type: 'gemini_error',
        message: 'Missing GOOGLE_CLOUD_PROJECT for Vertex AI mode',
        timestamp: new Date().toISOString(),
      });
    } else {
      const geminiBridge = new GeminiLiveBridge({
        apiKey: params.geminiApiKey,
        useVertex: params.useVertex,
        project: params.vertexProject,
        location: params.vertexLocation,
        model: params.geminiModel,
        systemInstruction: params.geminiSystemInstruction,
        callbacks: {
          onReady: () => {
            state.geminiReady = true;
            log('INFO', 'gemini.native.session.ready', {
              connectionId,
              model: params.geminiModel,
            });
            sendJson(socket, {
              type: 'gemini_session_ready',
              model: params.geminiModel,
              timestamp: new Date().toISOString(),
            });
          },
          onAudioChunk: (audioPcm16) => {
            sendFramedBinary(socket, SERVER_AUDIO_FRAME_TYPE, audioPcm16);
          },
          onText: (text) => {
            sendJson(socket, {
              type: 'gemini_text',
              text,
              timestamp: new Date().toISOString(),
            });
          },
          onTurnComplete: () => {
            state.suppressMicForwarding = false;
            sendJson(socket, {
              type: 'gemini_turn_complete',
              timestamp: new Date().toISOString(),
            });
          },
          onInterrupted: () => {
            state.suppressMicForwarding = false;
            sendJson(socket, {
              type: 'model_interrupted',
              timestamp: new Date().toISOString(),
            });
          },
          onError: (message) => {
            state.suppressMicForwarding = false;
            log('ERROR', 'gemini.native.session.error', { connectionId, message });
            sendJson(socket, {
              type: 'gemini_error',
              message,
              timestamp: new Date().toISOString(),
            });
          },
          onClose: (reason) => {
            state.geminiReady = false;
            state.suppressMicForwarding = false;
            log('INFO', 'gemini.native.session.closed', { connectionId, reason });
            if (state.suppressNextCloseError) {
              state.suppressNextCloseError = false;
              return;
            }
            sendJson(socket, {
              type: 'gemini_error',
              message: `Gemini session closed: ${reason}`,
              timestamp: new Date().toISOString(),
            });
          },
        },
      });

      state.gemini = geminiBridge;
      void geminiBridge.connect().catch((error: Error) => {
        log('ERROR', 'gemini.native.session.connect_failed', {
          connectionId,
          error: error.message,
        });
        sendJson(socket, {
          type: 'gemini_error',
          message: `Gemini connection failed: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
      });
    }

    socket.on('message', async (data: RawData, isBinary) => {
      if (isBinary) {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (bytes.length < 2) {
          sendJson(socket, {
            type: 'error',
            code: 'INVALID_BINARY_FRAME',
            message: 'Binary frame too small',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const frameType = bytes.readUInt8(0);
        const payload = bytes.subarray(1);
        if (frameType !== CLIENT_AUDIO_FRAME_TYPE) {
          sendJson(socket, {
            type: 'error',
            code: 'INVALID_BINARY_FRAME',
            message: `Unknown binary frame type ${frameType}`,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        state.receivedAudioFrames += 1;
        state.receivedAudioBytes += payload.byteLength;
        if (!state.suppressMicForwarding) {
          state.gemini?.sendAudioChunk(payload, state.inputSampleRate);
        }

        if (state.receivedAudioFrames % 25 === 0) {
          log('INFO', 'audio.native.mic.progress', {
            connectionId,
            receivedFrames: state.receivedAudioFrames,
            receivedBytes: state.receivedAudioBytes,
          });
          sendJson(socket, {
            type: 'binary_stub_received',
            byteLength: payload.byteLength,
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      const raw = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
      let parsed: ClientToServerMessage;
      try {
        parsed = JSON.parse(raw) as ClientToServerMessage;
      } catch {
        sendJson(socket, {
          type: 'error',
          code: 'INVALID_JSON',
          message: 'Invalid JSON payload',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (parsed.type === 'client_hello') {
        log('INFO', 'ws.native.client.hello', { connectionId, clientId: parsed.clientId });
        return;
      }

      if (parsed.type === 'ping') {
        sendJson(socket, {
          type: 'pong',
          requestId: parsed.requestId,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (parsed.type === 'start_listening') {
        state.listening = true;
        state.inputSampleRate = parsed.sampleRate;
        log('INFO', 'audio.native.listening.started', {
          connectionId,
          sampleRate: parsed.sampleRate,
          chunkSize: parsed.chunkSize,
          encoding: parsed.encoding,
        });
        sendJson(socket, {
          type: 'listening_ack',
          sampleRate: parsed.sampleRate,
          chunkSize: parsed.chunkSize,
          encoding: AUDIO_ENCODING,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (parsed.type === 'stop_listening') {
        state.listening = false;
        state.suppressMicForwarding = false;
        state.gemini?.sendAudioStreamEnd();
        return;
      }

      if (parsed.type === 'send_text_prompt') {
        if (!state.geminiReady) {
          sendJson(socket, {
            type: 'gemini_error',
            message: 'Gemini session is not ready yet',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        state.suppressMicForwarding = true;
        state.gemini?.sendAudioStreamEnd();
        state.gemini?.sendTextPrompt(parsed.text);
        return;
      }

      if (parsed.type === 'send_snapshot_prompt') {
        if (!state.geminiReady) {
          sendJson(socket, {
            type: 'gemini_error',
            message: 'Gemini session is not ready yet',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        const imageBytes = getBase64ByteLength(parsed.imageBase64);
        if (imageBytes <= 0) {
          sendJson(socket, {
            type: 'gemini_error',
            message: 'Snapshot payload is empty or invalid',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        state.suppressMicForwarding = true;
        state.gemini?.sendAudioStreamEnd();
        state.gemini?.sendImagePrompt(parsed.question, parsed.imageBase64, parsed.mimeType);
        sendJson(socket, {
          type: 'snapshot_received',
          requestId: parsed.requestId,
          mimeType: parsed.mimeType,
          imageBytes,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (parsed.type === 'barge_in') {
        state.suppressMicForwarding = false;
        state.geminiReady = false;
        state.suppressNextCloseError = true;
        sendJson(socket, {
          type: 'model_interrupted',
          timestamp: new Date().toISOString(),
        });
        try {
          await state.gemini?.interruptGeneration();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown interrupt failure';
          sendJson(socket, {
            type: 'gemini_error',
            message: `Barge-in failed: ${message}`,
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      sendJson(socket, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE',
        message: 'Unsupported message type',
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('close', (code, reason) => {
      cleanupGemini(state);
      log('INFO', 'ws.native.connection.closed', {
        connectionId,
        code,
        reason: reason.toString(),
        receivedAudioFrames: state.receivedAudioFrames,
        receivedAudioBytes: state.receivedAudioBytes,
      });
    });

    socket.on('error', (error) => {
      cleanupGemini(state);
      log('ERROR', 'ws.native.connection.error', {
        connectionId,
        error: error.message,
      });
    });
  });
}
