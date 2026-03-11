import { useEffect, useMemo, useRef, useState } from 'react';
import { MicrophoneStreamer, resamplePcm16 } from './microphone';
import { StreamingPcmPlayer } from './player';
import {
  AUDIO_ENCODING,
  CLIENT_AUDIO_FRAME_TYPE,
  SERVER_AUDIO_FRAME_TYPE,
  type AgentUiState,
  type ClientToServerMessage,
  type ServerToClientMessage,
  createClientId,
} from './protocol';

type LogEntry = {
  id: string;
  direction: 'outbound' | 'inbound' | 'system';
  message: string;
  timestamp: string;
};

const BARGE_IN_ENERGY_THRESHOLD = 0.04;
const BARGE_IN_CONSECUTIVE_FRAMES = 4;
const BARGE_IN_COOLDOWN_MS = 1500;
const BARGE_IN_ARM_DELAY_MS = 700;
const CAMERA_SNAPSHOT_MIME = 'image/jpeg';

function nowIso(): string {
  return new Date().toISOString();
}

function id(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);
}

function getNormalizedEnergy(pcm16: Int16Array): number {
  if (pcm16.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let i = 0; i < pcm16.length; i += 1) {
    const normalized = pcm16[i] / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / pcm16.length);
}

export function NativeLiveAgentPanel() {
  const wsUrl = (import.meta.env.VITE_NATIVE_LIVE_WS_URL as string | undefined) ?? 'ws://localhost:8787/ws';
  const [status, setStatus] = useState<AgentUiState>('disconnected');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [lastAgentText, setLastAgentText] = useState<string>('');
  const [micAckCount, setMicAckCount] = useState(0);
  const [lastMicAckBytes, setLastMicAckBytes] = useState<number | null>(null);
  const [promptText, setPromptText] = useState('Give me one fun fact about space.');
  const [snapshotQuestion, setSnapshotQuestion] = useState('What do you see in this image?');
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicrophoneStreamer | null>(null);
  const playerRef = useRef<StreamingPcmPlayer | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<AgentUiState>('disconnected');
  const micInputSampleRateRef = useRef<number>(16000);
  const consecutiveSpeechFramesRef = useRef(0);
  const lastBargeInAtRef = useRef(0);
  const canBargeInRef = useRef(false);
  const bargeInArmAtRef = useRef(0);
  const modelInputSampleRate = 16000;
  const clientId = useMemo(() => createClientId(), []);

  const pushLog = (entry: Omit<LogEntry, 'id' | 'timestamp'>): void => {
    setLogs((prev) => [
      { id: id(), timestamp: nowIso(), ...entry },
      ...prev,
    ].slice(0, 25));
  };

  const sendJson = (message: ClientToServerMessage): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
    pushLog({ direction: 'outbound', message: JSON.stringify(message) });
  };

  const sendMicFrame = (pcm16: Int16Array): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const resampled = resamplePcm16(pcm16, micInputSampleRateRef.current, modelInputSampleRate);
    const pcmBytes = new Uint8Array(resampled.buffer, resampled.byteOffset, resampled.byteLength);
    const frame = new Uint8Array(1 + pcmBytes.byteLength);
    frame[0] = CLIENT_AUDIO_FRAME_TYPE;
    frame.set(pcmBytes, 1);
    socket.send(frame);

    if (statusRef.current === 'speaking' && canBargeInRef.current) {
      if (Date.now() < bargeInArmAtRef.current) return;
      const energy = getNormalizedEnergy(resampled);
      if (energy >= BARGE_IN_ENERGY_THRESHOLD) {
        consecutiveSpeechFramesRef.current += 1;
      } else {
        consecutiveSpeechFramesRef.current = 0;
      }
      const nowMs = Date.now();
      if (
        consecutiveSpeechFramesRef.current >= BARGE_IN_CONSECUTIVE_FRAMES &&
        nowMs - lastBargeInAtRef.current >= BARGE_IN_COOLDOWN_MS
      ) {
        lastBargeInAtRef.current = nowMs;
        consecutiveSpeechFramesRef.current = 0;
        canBargeInRef.current = false;
        playerRef.current?.stopAndFlush();
        setStatus('listening');
        sendJson({ type: 'barge_in', requestId: id(), energy, timestamp: nowIso() });
      }
    }
  };

  const startMicrophone = async (): Promise<void> => {
    if (isMicEnabled) return;
    const mic = new MicrophoneStreamer();
    const started = await mic.start((pcm16) => sendMicFrame(pcm16));
    micInputSampleRateRef.current = started.sampleRate;
    micRef.current = mic;
    setIsMicEnabled(true);
    setStatus('listening');
    sendJson({
      type: 'start_listening',
      sampleRate: modelInputSampleRate,
      chunkSize: started.chunkSize,
      encoding: AUDIO_ENCODING,
      timestamp: nowIso(),
    });
  };

  const stopMicrophone = async (): Promise<void> => {
    if (!micRef.current) return;
    sendJson({ type: 'stop_listening', timestamp: nowIso() });
    await micRef.current.stop();
    micRef.current = null;
    setIsMicEnabled(false);
  };

  const startCamera = async (): Promise<void> => {
    if (cameraStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setCameraError(null);
      setIsCameraEnabled(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start camera';
      setCameraError(message);
    }
  };

  const stopCamera = (): void => {
    const stream = cameraStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setIsCameraEnabled(false);
  };

  const connect = (): void => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return;
    setStatus('connecting');
    const socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    socket.onopen = () => {
      playerRef.current = playerRef.current ?? new StreamingPcmPlayer();
      sendJson({ type: 'client_hello', clientId, timestamp: nowIso() });
      void startMicrophone();
    };

    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data) as ServerToClientMessage;
          if (parsed.type === 'gemini_session_ready') {
            setActiveModel(parsed.model);
            setStatus('listening');
          }
          if (parsed.type === 'gemini_text') {
            setLastAgentText(parsed.text);
          }
          if (parsed.type === 'binary_stub_received') {
            setMicAckCount((current) => current + 1);
            setLastMicAckBytes(parsed.byteLength);
          }
          if (parsed.type === 'gemini_turn_complete' || parsed.type === 'model_interrupted') {
            canBargeInRef.current = false;
            consecutiveSpeechFramesRef.current = 0;
            setStatus('listening');
          }
          if (parsed.type === 'gemini_error') {
            canBargeInRef.current = false;
            playerRef.current?.stopAndFlush();
            setStatus('listening');
          }
          pushLog({ direction: 'inbound', message: JSON.stringify(parsed) });
        } catch {
          pushLog({ direction: 'system', message: 'Invalid JSON received from native socket' });
        }
        return;
      }

      const bytes = new Uint8Array(event.data);
      if (bytes.length < 2) return;
      const frameType = bytes[0];
      const payload = bytes.subarray(1);
      if (frameType !== SERVER_AUDIO_FRAME_TYPE || payload.byteLength % 2 !== 0) return;
      const aligned = new Uint8Array(payload.byteLength);
      aligned.set(payload);
      const pcm = new Int16Array(aligned.buffer);
      playerRef.current?.enqueuePcm16(pcm);
      void playerRef.current?.start();
      canBargeInRef.current = true;
      bargeInArmAtRef.current = Date.now() + BARGE_IN_ARM_DELAY_MS;
      setStatus('speaking');
    };

    socket.onclose = async () => {
      await stopMicrophone();
      playerRef.current?.stopAndFlush();
      setStatus('disconnected');
      setActiveModel(null);
      socketRef.current = null;
    };
  };

  const disconnect = (): void => {
    socketRef.current?.close(1000, 'Client disconnect');
    socketRef.current = null;
    setStatus('disconnected');
  };

  const sendTextPrompt = (): void => {
    const text = promptText.trim();
    if (!text) return;
    sendJson({ type: 'send_text_prompt', requestId: id(), text, timestamp: nowIso() });
  };

  const sendSnapshotPrompt = (): void => {
    if (!cameraVideoRef.current || !captureCanvasRef.current || !cameraStreamRef.current) return;
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL(CAMERA_SNAPSHOT_MIME, 0.9);
    const prefix = `data:${CAMERA_SNAPSHOT_MIME};base64,`;
    const imageBase64 = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : '';
    if (!imageBase64) return;
    sendJson({
      type: 'send_snapshot_prompt',
      requestId: id(),
      question: snapshotQuestion.trim() || 'What do you see in this image?',
      mimeType: CAMERA_SNAPSHOT_MIME,
      imageBase64,
      timestamp: nowIso(),
    });
  };

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      stopCamera();
      socketRef.current?.close(1000, 'Unmount cleanup');
      void micRef.current?.stop();
      void playerRef.current?.destroy();
    };
  }, []);

  return (
    <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-900 p-4 space-y-3">
      <p className="text-[11px] font-semibold text-stone-500 dark:text-zinc-400 uppercase tracking-wide">
        Native LiveAgent Runtime
      </p>
      <p className="text-xs text-stone-500 dark:text-zinc-400">
        Status: <strong>{status}</strong> | Model: <strong>{activeModel ?? 'not ready'}</strong>
      </p>
      <p className="text-xs text-stone-500 dark:text-zinc-400">
        Mic uplink: <strong>{micAckCount > 0 ? 'active' : 'waiting'}</strong>
        {lastMicAckBytes !== null ? ` (${lastMicAckBytes} bytes/frame ack)` : ''}
      </p>
      {lastAgentText ? (
        <p className="text-xs text-stone-600 dark:text-zinc-300">
          Last agent text: <span className="font-semibold">{lastAgentText}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={connect} className="px-3 py-1.5 rounded-lg border text-xs font-semibold">
          Connect
        </button>
        <button type="button" onClick={disconnect} className="px-3 py-1.5 rounded-lg border text-xs font-semibold">
          Disconnect
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          placeholder="Ask with text prompt"
          className="md:col-span-3 w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm"
        />
        <button type="button" onClick={sendTextPrompt} className="px-4 py-2 rounded-lg border text-sm font-semibold">
          Send
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          value={snapshotQuestion}
          onChange={(event) => setSnapshotQuestion(event.target.value)}
          placeholder="Snapshot question"
          className="md:col-span-2 w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm"
        />
        <button type="button" onClick={() => void startCamera()} className="px-3 py-2 rounded-lg border text-xs font-semibold">
          Start Camera
        </button>
        <button type="button" onClick={stopCamera} className="px-3 py-2 rounded-lg border text-xs font-semibold">
          Stop Camera
        </button>
      </div>
      <button type="button" onClick={sendSnapshotPrompt} className="px-3 py-2 rounded-lg border text-xs font-semibold">
        Send Snapshot
      </button>
      {cameraError ? <p className="text-xs text-red-500">{cameraError}</p> : null}
      <video ref={cameraVideoRef} autoPlay muted playsInline className="w-full max-w-md rounded border border-stone-200 dark:border-zinc-800" />
      <canvas ref={captureCanvasRef} className="hidden" />
      <div className="max-h-28 overflow-y-auto bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg p-2 space-y-1">
        {logs.length === 0 ? (
          <p className="text-xs text-stone-400 dark:text-zinc-500">No native logs yet.</p>
        ) : (
          logs.map((entry) => (
            <p key={entry.id} className="text-xs text-stone-500 dark:text-zinc-400">
              <span className="font-semibold">{entry.direction}:</span> {entry.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
