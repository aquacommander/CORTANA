/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, WorkflowViewState } from './types';
import { generateTextImage, generateTextVideo, generateStyleSuggestion } from './services/geminiService';
import { apiClient } from './services/apiClient';
import { LiveWsClient } from './services/liveWsClient';
import { getRandomStyle, fileToBase64, TYPOGRAPHY_SUGGESTIONS, createGifFromVideo } from './utils';
import { Loader2, Paintbrush, Clapperboard, Play, ExternalLink, Type, Sparkles, Image as ImageIcon, X, Upload, Download, FileType, Wand2, Volume2, VolumeX, ChevronLeft, ChevronRight, ArrowLeft, Video as VideoIcon, Key, Info, ShieldCheck } from 'lucide-react';
import { LiveIntent, Session, WorkflowStage } from './shared/contracts';
import { WORKFLOW_STAGES } from './shared/workflow';

interface Video {
  id: string;
  title: string;
  videoUrl: string;
  description: string;
}

const staticFilesUrl = 'https://www.gstatic.com/aistudio/starter-apps/type-motion/';
const liveWsBase = (import.meta as any).env?.VITE_LIVE_WS_BASE || 'ws://localhost:8787';

type AiStudioBridge = {
  hasSelectedApiKey?: () => Promise<boolean>;
  openSelectKey?: () => Promise<void>;
};

const getConfiguredApiKey = (): string => (process.env.API_KEY || "").trim();

const hasConfiguredApiKey = (): boolean => getConfiguredApiKey().length > 0;

const getAiStudioBridge = (): AiStudioBridge | undefined => (window as any).aistudio;

const hasAnyUsableApiKey = async (): Promise<boolean> => {
  if (hasConfiguredApiKey()) return true;

  const bridge = getAiStudioBridge();
  if (bridge?.hasSelectedApiKey) {
    return Boolean(await bridge.hasSelectedApiKey());
  }
  return false;
};

const WORKFLOW_STAGE_PROGRESS: Record<WorkflowStage, number> = {
  INTAKE: 16,
  STORY_GENERATION: 38,
  STORY_REVIEW: 55,
  NAVIGATOR_ANALYSIS: 72,
  NAVIGATOR_EXECUTION: 88,
  COMPLETION: 100,
};

const getWorkflowViewState = (viewMode: 'gallery' | 'create', appState: AppState): WorkflowViewState => {
  if (viewMode === 'gallery') {
    return { stage: 'INTAKE', progressPercent: WORKFLOW_STAGE_PROGRESS.INTAKE };
  }

  if (appState === AppState.GENERATING_IMAGE || appState === AppState.GENERATING_VIDEO) {
    return { stage: 'STORY_GENERATION', progressPercent: WORKFLOW_STAGE_PROGRESS.STORY_GENERATION };
  }

  if (appState === AppState.PLAYING) {
    return { stage: 'STORY_REVIEW', progressPercent: WORKFLOW_STAGE_PROGRESS.STORY_REVIEW };
  }

  if (appState === AppState.ERROR) {
    return { stage: 'STORY_GENERATION', progressPercent: WORKFLOW_STAGE_PROGRESS.STORY_GENERATION };
  }

  return { stage: 'STORY_GENERATION', progressPercent: WORKFLOW_STAGE_PROGRESS.STORY_GENERATION };
};

export const MOCK_VIDEOS: Video[] = [
  {
    id: '1',
    title: "Cloud Formations",
    videoUrl: staticFilesUrl + 'clouds_v2.mp4',
    description: "Text formed by fluffy white clouds in a deep blue summer sky.",
  },
  {
    id: '2',
    title: "Elemental Fire",
    videoUrl: staticFilesUrl + 'fire_v2.mp4',
    description: "Flames erupt into text in an arid dry environment.",
  },
  {
    id: '3',
    title: "Mystic Smoke",
    videoUrl: staticFilesUrl + 'smoke_v2.mp4',
    description: "A sudden wave of smoke swirling to reveal the text.",
  },
  {
    id: '4',
    title: "Water Blast",
    videoUrl: staticFilesUrl + 'water_v2.mp4',
    description: "A wall of water punching through text with power.",
  },
];

const ApiKeyDialog: React.FC<{ isOpen: boolean; onClose: () => void; onSelect: () => void; canUseAiStudio: boolean; hasEnvKey: boolean }> = ({ isOpen, onClose, onSelect, canUseAiStudio, hasEnvKey }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-stone-100 dark:border-zinc-800 animate-in zoom-in-95 duration-300">
        <div className="p-6">
          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center mb-4">
            <Key className="text-amber-600 dark:text-amber-500" size={24} />
          </div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-white mb-2">Gemini API Key Required</h2>
          <p className="text-stone-500 dark:text-stone-400 text-sm leading-relaxed mb-6">
            To use cinematic video generation models (like Veo), you must provide an API key from a Google Cloud project with 
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-stone-900 dark:text-stone-100 underline decoration-stone-300 hover:decoration-stone-900 font-medium ml-1">billing enabled</a>. 
            Free-tier keys do not support these high-end features.
          </p>

          <div className="bg-stone-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-stone-100 dark:border-zinc-800 mb-6">
            <div className="flex items-start gap-3">
              <div className="text-xs text-stone-500 dark:text-stone-400 space-y-2">
                <p>• Make sure your project is linked to a valid billing account.</p>
                <p>• Check the <a href="https://ai.google.dev/pricing" target="_blank" rel="noopener noreferrer" className="underline">pricing documentation</a> for more details.</p>
                <p>• Set `GEMINI_API_KEY` in `.env.local` and restart the app.</p>
                {hasEnvKey && <p>• Environment key detected. You can close this dialog and continue.</p>}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={onSelect}
              className="flex-1 py-3 px-4 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-xl text-sm font-bold shadow-lg shadow-stone-900/10 hover:bg-stone-800 dark:hover:bg-white transition-all flex items-center justify-center gap-2"
            >
              {hasEnvKey ? 'Use Environment Key' : (canUseAiStudio ? 'Select API Key' : 'Open Setup Guide')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const HeroCarousel: React.FC<{ forceMute: boolean }> = ({ forceMute }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const video = MOCK_VIDEOS[currentIndex];

  useEffect(() => {
    if (forceMute) {
      setIsMuted(true);
    }
  }, [forceMute]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % MOCK_VIDEOS.length);
  }, []);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + MOCK_VIDEOS.length) % MOCK_VIDEOS.length);
  }, []);

  return (
    <div className="absolute inset-0 bg-black group">
      <video
        key={video.id}
        src={video.videoUrl}
        className="w-full h-full object-cover"
        autoPlay
        muted={isMuted}
        playsInline
        onEnded={handleNext}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent pointer-events-none transition-opacity duration-500" />
      <div className="absolute bottom-0 left-0 p-8 w-full md:w-3/4 text-white pointer-events-none">
        <div className="animate-in slide-in-from-bottom-2 fade-in duration-700 key={video.id}">
          <h3 className="text-xl md:text-2xl font-bold mb-2 drop-shadow-lg">{video.title}</h3>
          <p className="text-xs md:text-sm text-stone-300 line-clamp-2 leading-relaxed drop-shadow-md opacity-90">
            {video.description}
          </p>
        </div>
      </div>
      <button 
        onClick={() => setIsMuted(!isMuted)}
        className="absolute top-6 right-6 p-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-full text-white hover:bg-black/60 transition-all z-20"
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
      <div className="absolute inset-y-0 left-0 flex items-center px-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={handlePrev} className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-white hover:text-black transition-all transform hover:scale-110">
          <ChevronLeft size={28} />
        </button>
      </div>
      <div className="absolute inset-y-0 right-0 flex items-center px-4 opacity-0 group-hover:opacity-100 transition-opacity">
         <button onClick={handleNext} className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-white hover:text-black transition-all transform hover:scale-110">
          <ChevronRight size={28} />
        </button>
      </div>
      <div className="absolute bottom-6 right-8 flex gap-2 z-10">
        {MOCK_VIDEOS.map((_, idx) => (
          <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-8 bg-white' : 'w-2 bg-white/30'}`} />
        ))}
      </div>
    </div>
  );
};

const WorkflowProgress: React.FC<{ activeStage: WorkflowStage; progressPercent: number }> = ({ activeStage, progressPercent }) => {
  return (
    <div className="w-full max-w-7xl px-4 lg:px-6 pt-4">
      <div className="bg-white/90 dark:bg-zinc-900/90 border border-stone-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">Unified Agent Workflow</p>
          <p className="text-xs font-semibold text-stone-600 dark:text-zinc-300">{progressPercent}%</p>
        </div>
        <div className="w-full h-2 bg-stone-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-stone-900 dark:bg-stone-100 transition-all duration-700" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {WORKFLOW_STAGES.map((stage) => {
            const isActive = stage.id === activeStage;
            return (
              <div
                key={stage.id}
                className={`rounded-lg border px-2.5 py-2 text-[11px] leading-tight transition-colors ${
                  isActive
                    ? 'border-stone-900 dark:border-stone-200 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400'
                }`}
              >
                {stage.label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const getStoryAssetUrl = (session: Session | null, type: 'image' | 'video'): string | undefined => {
  const block = session?.storyOutput?.blocks.find((item) => item.type === type);
  return block?.assetUrl;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [viewMode, setViewMode] = useState<'gallery' | 'create'>('gallery');
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workflowStageOverride, setWorkflowStageOverride] = useState<WorkflowStage | null>(null);
  const [sessionLookupId, setSessionLookupId] = useState<string>("");
  const [loadedSession, setLoadedSession] = useState<Session | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(false);
  const [isRestartingSession, setIsRestartingSession] = useState<boolean>(false);
  const [isRerunningNavigator, setIsRerunningNavigator] = useState<boolean>(false);
  const [isRealtimeConnecting, setIsRealtimeConnecting] = useState<boolean>(false);
  const [recentSessions, setRecentSessions] = useState<Array<{
    sessionId: string;
    goal: string;
    status: Session['status'];
    workflowStage: Session['workflowStage'];
    updatedAt: string;
  }>>([]);
  const [isRefreshingSessions, setIsRefreshingSessions] = useState<boolean>(false);
  const [navigatorTargetUrl, setNavigatorTargetUrl] = useState<string>("");
  const [navigatorMode, setNavigatorMode] = useState<'mock' | 'playwright'>('mock');
  const [intakeMessage, setIntakeMessage] = useState<string>("");
  const [intakeTranscript, setIntakeTranscript] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isSendingIntake, setIsSendingIntake] = useState<boolean>(false);
  const [isListeningIntake, setIsListeningIntake] = useState<boolean>(false);
  const [isAgentTyping, setIsAgentTyping] = useState<boolean>(false);
  const [useStreamingReplies, setUseStreamingReplies] = useState<boolean>(true);
  const [useWebSocketLive, setUseWebSocketLive] = useState<boolean>(true);
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [wsClientId, setWsClientId] = useState<string>('');
  const [wsConnectionId, setWsConnectionId] = useState<string>('');
  const [wsActiveModel, setWsActiveModel] = useState<string>('');
  const [micChunksSent, setMicChunksSent] = useState<number>(0);
  const [audioBytesReceived, setAudioBytesReceived] = useState<number>(0);
  const [lastBackendAudioAckBytes, setLastBackendAudioAckBytes] = useState<number>(0);
  const [isAudioStreaming, setIsAudioStreaming] = useState<boolean>(false);
  const [isCameraStreaming, setIsCameraStreaming] = useState<boolean>(false);
  const [speakAgentReplies, setSpeakAgentReplies] = useState<boolean>(false);
  const [isRegeneratingBlock, setIsRegeneratingBlock] = useState<boolean>(false);

  const [inputText, setInputText] = useState<string>("");
  const [inputStyle, setInputStyle] = useState<string>("");
  const [typographyPrompt, setTypographyPrompt] = useState<string>("");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [screenRecording, setScreenRecording] = useState<string | null>(null);
  const [useRealtimeLive, setUseRealtimeLive] = useState<boolean>(false);
  const [liveRealtimeSessionId, setLiveRealtimeSessionId] = useState<string | null>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isGifGenerating, setIsGifGenerating] = useState<boolean>(false);
  const [isSuggestingStyle, setIsSuggestingStyle] = useState<boolean>(false);
  const hasEnvKey = hasConfiguredApiKey();
  const canUseAiStudio = !hasEnvKey && Boolean(getAiStudioBridge()?.openSelectKey && getAiStudioBridge()?.hasSelectedApiKey);
  const computedWorkflowViewState = workflowStageOverride
    ? { stage: workflowStageOverride, progressPercent: WORKFLOW_STAGE_PROGRESS[workflowStageOverride] }
    : getWorkflowViewState(viewMode, state);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingInputRef = useRef<HTMLInputElement>(null);
  const intakeAbortRef = useRef<AbortController | null>(null);
  const intakeRecognitionRef = useRef<any>(null);
  const liveWsRef = useRef<LiveWsClient | null>(null);
  const wsAudioBufferRef = useRef<{ streamId: string; mimeType: string; chunks: string[] } | null>(null);
  const wsAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const wsVoiceFallbackTimerRef = useRef<number | null>(null);
  const wsAudioStartedForTurnRef = useRef<boolean>(false);
  const audioMediaRecorderRef = useRef<any>(null);
  const audioMediaStreamRef = useRef<MediaStream | null>(null);
  const pcmStreamContextRef = useRef<AudioContext | null>(null);
  const pcmSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const pcmSinkGainRef = useRef<GainNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceDataRef = useRef<Uint8Array | null>(null);
  const voiceRafRef = useRef<number | null>(null);
  const liveVoiceStateRef = useRef<{
    isUserSpeaking: boolean;
    hasSpeechInTurn: boolean;
    lastVoiceAtMs: number;
    autoCommitLock: boolean;
  }>({
    isUserSpeaking: false,
    hasSpeechInTurn: false,
    lastVoiceAtMs: 0,
    autoCommitLock: false,
  });
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraIntervalRef = useRef<any>(null);

  useEffect(() => {
    if (state === AppState.GENERATING_IMAGE || state === AppState.GENERATING_VIDEO || state === AppState.PLAYING) {
      setViewMode('create');
    }
  }, [state]);

  useEffect(() => {
    if (viewMode !== 'create') return;
    const loadRecentSessions = async () => {
      setIsRefreshingSessions(true);
      try {
        const { sessions } = await apiClient.listSessions();
        setRecentSessions(
          [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 8),
        );
      } catch {
        // Silent by design; manual controls are still available.
      } finally {
        setIsRefreshingSessions(false);
      }
    };
    loadRecentSessions();
  }, [viewMode]);

  useEffect(() => {
    return () => {
      intakeAbortRef.current?.abort();
      if (audioMediaRecorderRef.current && audioMediaRecorderRef.current.state !== 'inactive') {
        try {
          audioMediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      stopPcmStreaming();
      if (wsAudioElementRef.current) {
        try {
          wsAudioElementRef.current.pause();
        } catch {
          // ignore
        }
      }
      wsAudioElementRef.current = null;
      wsAudioBufferRef.current = null;
      clearWsVoiceFallbackTimer();
      stopVoiceActivityDetection();
      audioMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (cameraIntervalRef.current) clearInterval(cameraIntervalRef.current);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      liveWsRef.current?.close();
      if (intakeRecognitionRef.current) {
        try {
          intakeRecognitionRef.current.stop();
        } catch {
          // ignore stop errors on unmount
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!speakAgentReplies) {
      stopWsAudioPlayback();
      wsAudioBufferRef.current = null;
      clearWsVoiceFallbackTimer();
    }
  }, [speakAgentReplies]);

  useEffect(() => {
    if (!speakAgentReplies || !useWebSocketLive || isAudioStreaming) return;
    void handleStartAudioStream();
  }, [speakAgentReplies, useWebSocketLive, isAudioStreaming]);

  const handleSelectKey = async () => {
    if (hasConfiguredApiKey()) {
      setShowKeyDialog(false);
      if (state === AppState.IDLE && viewMode === 'gallery') {
        setViewMode('create');
      }
      return;
    }

    const bridge = getAiStudioBridge();
    if (bridge?.openSelectKey && bridge?.hasSelectedApiKey) {
      await bridge.openSelectKey();

      const selected = await bridge.hasSelectedApiKey();
      if (selected) {
        setShowKeyDialog(false);
        if (state === AppState.IDLE && viewMode === 'gallery') {
          setViewMode('create');
        }
      } else {
        // Keep dialog open if selection did not succeed.
        setShowKeyDialog(true);
      }
      return;
    }

    window.open('https://ai.google.dev/gemini-api/docs/api-key', '_blank', 'noopener,noreferrer');
  };

  const handleMainCta = async () => {
    const isKeySelected = await hasAnyUsableApiKey();
    if (!isKeySelected) {
      setShowKeyDialog(true);
    } else {
      setViewMode('create');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const refreshLoadedSession = async (id: string) => {
    const { session } = await apiClient.getSession(id);
    setLoadedSession(session);
    setSessionId(session.sessionId);
    setWorkflowStageOverride(session.workflowStage);
    setNavigatorTargetUrl(session.navigatorTargetUrl || "");
    return session;
  };

  const handleRefreshSessionList = async () => {
    setIsRefreshingSessions(true);
    try {
      const { sessions } = await apiClient.listSessions();
      setRecentSessions(
        [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 8),
      );
    } catch (error: any) {
      setStatusMessage(error.message || 'Unable to refresh session list');
    } finally {
      setIsRefreshingSessions(false);
    }
  };

  const handleLoadSession = async () => {
    const id = sessionLookupId.trim();
    if (!id) return;
    setIsLoadingSession(true);
    try {
      const session = await refreshLoadedSession(id);
      setStatusMessage(`Loaded session: ${session.status}`);
      setViewMode('create');
      await handleRefreshSessionList();
    } catch (error: any) {
      setStatusMessage(error.message || 'Unable to load session');
      setLoadedSession(null);
    } finally {
      setIsLoadingSession(false);
    }
  };

  const handleRestartFromReview = async () => {
    const id = (loadedSession?.sessionId || sessionId || sessionLookupId).trim();
    if (!id) return;
    setIsRestartingSession(true);
    try {
      const { session } = await apiClient.restartSessionFromReview(id);
      setLoadedSession(session);
      setSessionId(session.sessionId);
      setWorkflowStageOverride(session.workflowStage);
      setSessionLookupId(session.sessionId);
      setStatusMessage('Session restarted from STORY_REVIEW');
      setViewMode('create');
      await handleRefreshSessionList();
    } catch (error: any) {
      setStatusMessage(error.message || 'Unable to restart session');
    } finally {
      setIsRestartingSession(false);
    }
  };

  const handleRerunNavigator = async () => {
    const id = (loadedSession?.sessionId || sessionId || sessionLookupId).trim();
    if (!id) return;
    setIsRerunningNavigator(true);
    try {
      await apiClient.analyzeNavigator({
        sessionId: id,
        screenshotBase64: referenceImage ? referenceImage.split(',')[1] || 'ZmFrZQ==' : 'ZmFrZQ==',
        screenRecordingBase64: screenRecording ? screenRecording.split(',')[1] || undefined : undefined,
        targetUrl: navigatorTargetUrl.trim() || undefined,
      });
      setWorkflowStageOverride('NAVIGATOR_ANALYSIS');
      const { executionResult } = await apiClient.executeNavigator({
        sessionId: id,
        mode: navigatorMode,
        targetUrl: navigatorTargetUrl.trim() || undefined,
        headless: true,
      });
      const session = await refreshLoadedSession(id);
      setStatusMessage(`Re-run finished with status: ${executionResult.status}`);
      setSessionLookupId(session.sessionId);
      await handleRefreshSessionList();
    } catch (error: any) {
      setStatusMessage(error.message || 'Navigator re-run failed');
    } finally {
      setIsRerunningNavigator(false);
    }
  };

  const handleStartRealtimeLive = async () => {
    const id = (loadedSession?.sessionId || sessionId || sessionLookupId).trim();
    if (!id) {
      setStatusMessage('Load or create a session before starting realtime mode.');
      return;
    }
    setIsRealtimeConnecting(true);
    try {
      const result = await apiClient.startRealtimeLiveSession({ sessionId: id });
      setLiveRealtimeSessionId(result.liveSessionId);
      setUseRealtimeLive(true);
      setStatusMessage(`Realtime live session started (${result.mode}).`);
    } catch (error: any) {
      setStatusMessage(error.message || 'Unable to start realtime live session');
    } finally {
      setIsRealtimeConnecting(false);
    }
  };

  const handleStopRealtimeLive = async () => {
    if (!liveRealtimeSessionId) {
      setUseRealtimeLive(false);
      return;
    }
    try {
      await apiClient.stopRealtimeLiveSession(liveRealtimeSessionId);
    } catch {
      // best effort stop
    } finally {
      setLiveRealtimeSessionId(null);
      setUseRealtimeLive(false);
      setStatusMessage('Realtime live session stopped.');
    }
  };

  const applyLiveIntentToUi = (intent: LiveIntent) => {
    if (intent.readyForStoryGeneration) {
      setWorkflowStageOverride('STORY_GENERATION');
    } else {
      setWorkflowStageOverride('INTAKE');
    }
  };

  const appendAssistantMessage = (content: string) => {
    setIntakeTranscript((prev) => [...prev, { role: 'assistant', content }]);
  };

  function stopWsAudioPlayback() {
    if (!wsAudioElementRef.current) return;
    try {
      wsAudioElementRef.current.pause();
      wsAudioElementRef.current.src = '';
    } catch {
      // ignore
    }
    wsAudioElementRef.current = null;
  }

  function clearWsVoiceFallbackTimer() {
    if (wsVoiceFallbackTimerRef.current) {
      clearTimeout(wsVoiceFallbackTimerRef.current);
      wsVoiceFallbackTimerRef.current = null;
    }
  }

  function speakWithBrowserTts(text?: string) {
    if (!text || !speakAgentReplies || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors
    }
  }

  function scheduleWsVoiceFallback(replyText: string) {
    clearWsVoiceFallbackTimer();
    if (!speakAgentReplies) return;
    wsVoiceFallbackTimerRef.current = window.setTimeout(() => {
      if (wsAudioStartedForTurnRef.current) return;
      speakWithBrowserTts(replyText);
    }, 800);
  }

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...part);
    }
    return btoa(binary);
  };

  const stopPcmStreaming = () => {
    try {
      pcmWorkletNodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      pcmSourceNodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      pcmSinkGainRef.current?.disconnect();
    } catch {
      // ignore
    }
    if (pcmStreamContextRef.current) {
      void pcmStreamContextRef.current.close().catch(() => undefined);
    }
    pcmWorkletNodeRef.current = null;
    pcmSourceNodeRef.current = null;
    pcmSinkGainRef.current = null;
    pcmStreamContextRef.current = null;
  };

  const startPcmStreaming = async (stream: MediaStream): Promise<boolean> => {
    const AudioContextImpl = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextImpl || typeof (window as any).AudioWorkletNode !== 'function') {
      return false;
    }
    try {
      stopPcmStreaming();
      const context: AudioContext = new AudioContextImpl();
      const workletUrl = new URL('./audio/pcm16-worklet.js', import.meta.url);
      await context.audioWorklet.addModule(workletUrl);
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'pcm16-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: {
          targetSampleRate: 16000,
          frameSize: 2048,
        },
      });
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(worklet);
      worklet.connect(sink);
      sink.connect(context.destination);

      worklet.port.onmessage = (event: MessageEvent<any>) => {
        const payload = event.data || {};
        const buffer: ArrayBuffer | undefined = payload.buffer;
        if (!buffer || !liveWsRef.current) return;
        const base64 = arrayBufferToBase64(buffer);
        liveWsRef.current.sendAudioChunk(base64, {
          mimeType: 'audio/pcm;rate=16000',
          encoding: 'pcm_s16le',
          sampleRate: 16000,
          chunkSize: buffer.byteLength,
        });
        setMicChunksSent((prev) => prev + 1);
      };

      if (context.state === 'suspended') {
        await context.resume();
      }

      pcmStreamContextRef.current = context;
      pcmSourceNodeRef.current = source;
      pcmWorkletNodeRef.current = worklet;
      pcmSinkGainRef.current = sink;
      return true;
    } catch {
      stopPcmStreaming();
      return false;
    }
  };

  const stopVoiceActivityDetection = () => {
    if (voiceRafRef.current) {
      cancelAnimationFrame(voiceRafRef.current);
      voiceRafRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    voiceAnalyserRef.current = null;
    voiceDataRef.current = null;
    liveVoiceStateRef.current = {
      isUserSpeaking: false,
      hasSpeechInTurn: false,
      lastVoiceAtMs: 0,
      autoCommitLock: false,
    };
  };

  const startVoiceActivityDetection = async (stream: MediaStream) => {
    stopVoiceActivityDetection();
    const AudioContextImpl = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextImpl) return;
    const context: AudioContext = new AudioContextImpl();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    audioContextRef.current = context;
    voiceAnalyserRef.current = analyser;
    voiceDataRef.current = new Uint8Array(analyser.fftSize);

    const voiceThreshold = 0.018;
    const silenceMsToCommit = 1200;
    const minSpeakingMs = 200;
    let speakingSinceMs = 0;

    const tick = () => {
      const currentAnalyser = voiceAnalyserRef.current;
      const currentData = voiceDataRef.current;
      if (!currentAnalyser || !currentData) return;
      currentAnalyser.getByteTimeDomainData(currentData);
      let sum = 0;
      for (let i = 0; i < currentData.length; i += 1) {
        const normalized = (currentData[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / currentData.length);
      const now = Date.now();
      const state = liveVoiceStateRef.current;
      const speakingNow = rms > voiceThreshold;

      if (speakingNow) {
        if (!state.isUserSpeaking) {
          state.isUserSpeaking = true;
          speakingSinceMs = now;
          stopWsAudioPlayback();
          if ('speechSynthesis' in window) {
            try {
              window.speechSynthesis.cancel();
            } catch {
              // ignore
            }
          }
          liveWsRef.current?.interrupt();
          setStatusMessage('Listening...');
        }
        state.lastVoiceAtMs = now;
        if (now - speakingSinceMs >= minSpeakingMs) {
          state.hasSpeechInTurn = true;
        }
      } else if (state.isUserSpeaking && now - state.lastVoiceAtMs >= silenceMsToCommit) {
        state.isUserSpeaking = false;
        if (state.hasSpeechInTurn && !state.autoCommitLock) {
          state.autoCommitLock = true;
          liveWsRef.current?.commitAudio();
          setStatusMessage('Processing your spoken request...');
        }
      }

      voiceRafRef.current = requestAnimationFrame(tick);
    };

    voiceRafRef.current = requestAnimationFrame(tick);
  };

  const ensureWsConnected = async (activeSessionId: string) => {
    if (!liveWsRef.current) {
      liveWsRef.current = new LiveWsClient(liveWsBase);
      setWsClientId(liveWsRef.current.getClientId());
      liveWsRef.current.onEvent((event) => {
        if (event.type === 'hello_ack') {
          setWsConnectionId(event.connectionId);
        } else if (event.type === 'transcript') {
          liveVoiceStateRef.current.hasSpeechInTurn = false;
          liveVoiceStateRef.current.autoCommitLock = false;
          setIntakeTranscript((prev) => [...prev, { role: 'user', content: event.transcript }]);
        } else if (event.type === 'audio_output_start') {
          if (!speakAgentReplies) return;
          wsAudioStartedForTurnRef.current = true;
          clearWsVoiceFallbackTimer();
          wsAudioBufferRef.current = {
            streamId: event.streamId,
            mimeType: event.mimeType || 'audio/wav',
            chunks: [],
          };
        } else if (event.type === 'audio_output_frame') {
          if (!speakAgentReplies) return;
          if (!wsAudioBufferRef.current || wsAudioBufferRef.current.streamId !== event.streamId) return;
          wsAudioBufferRef.current.chunks.push(event.data);
          setAudioBytesReceived((prev) => prev + Math.floor((event.data.length * 3) / 4));
        } else if (event.type === 'audio_output_end') {
          const buffered = wsAudioBufferRef.current;
          wsAudioBufferRef.current = null;
          if (!speakAgentReplies) return;
          if (!buffered || buffered.streamId !== event.streamId || event.interrupted) return;
          const combined = buffered.chunks.join('');
          if (!combined) return;
          try {
            stopWsAudioPlayback();
            const audio = new Audio(`data:${buffered.mimeType};base64,${combined}`);
            wsAudioElementRef.current = audio;
            void audio.play().catch(() => undefined);
          } catch {
            // ignore playback failures
          }
        } else if (event.type === 'session_started') {
          setWsActiveModel(event.model || '');
          const provider = event.mode ? `${event.mode}${event.model ? ` (${event.model})` : ''}` : 'default';
          const fallback = event.fallbackReason ? ` | fallback: ${event.fallbackReason}` : '';
          setStatusMessage(`Live session connected: ${provider}${fallback}`);
        } else if (event.type === 'turn_started') {
          wsAudioStartedForTurnRef.current = false;
          clearWsVoiceFallbackTimer();
          setStatusMessage(`Live agent is processing ${event.source || 'input'}...`);
        } else if (event.type === 'audio_ack') {
          if (typeof event.bufferedChunks === 'number') {
            setStatusMessage(`Voice chunk received (${event.bufferedChunks} buffered)`);
            setLastBackendAudioAckBytes(event.bufferedChunks * 2048);
          }
        } else if (event.type === 'final') {
          if (event.source === 'audio') {
            liveVoiceStateRef.current.autoCommitLock = false;
            appendAssistantMessage(event.reply);
            setStatusMessage(event.reply);
            applyLiveIntentToUi(event.liveIntent);
            if (sessionId) {
              refreshLoadedSession(sessionId).catch(() => undefined);
            }
          } else {
            scheduleWsVoiceFallback(event.reply);
          }
        } else if (event.type === 'interrupted') {
          liveVoiceStateRef.current.autoCommitLock = false;
          stopWsAudioPlayback();
          wsAudioBufferRef.current = null;
          clearWsVoiceFallbackTimer();
        } else if (event.type === 'error') {
          liveVoiceStateRef.current.autoCommitLock = false;
          clearWsVoiceFallbackTimer();
          setStatusMessage(event.error);
        }
      });
    }
    await liveWsRef.current.connect(activeSessionId);
    setIsWsConnected(true);
    if (referenceImage) {
      liveWsRef.current.sendVisionFrame(referenceImage.split(',')[1] || referenceImage);
    }
  };

  const handleSendIntakeMessage = async () => {
    const message = intakeMessage.trim();
    if (!message) return;
    setIsSendingIntake(true);
    setIsAgentTyping(true);
    intakeAbortRef.current?.abort();
    const controller = new AbortController();
    intakeAbortRef.current = controller;
    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const { session } = await apiClient.createSession(message);
        activeSessionId = session.sessionId;
        setSessionId(session.sessionId);
        setSessionLookupId(session.sessionId);
      }
      setIntakeTranscript((prev) => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: '' },
      ]);
      setIntakeMessage("");
      const updateLatestAssistantMessage = (content: string) => {
        setIntakeTranscript((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === 'assistant') {
              next[i] = { ...next[i], content };
              break;
            }
          }
          return next;
        });
      };

      let response: { liveIntent: LiveIntent; reply: string };
      let realtimeReply = '';
      if (useRealtimeLive && liveRealtimeSessionId) {
        try {
          const rt = await apiClient.sendRealtimeLiveMessage(liveRealtimeSessionId, { message });
          realtimeReply = rt.reply;
        } catch {
          // keep primary flow reliable even if realtime preview fails
        }
      }
      const screenshotBase64 = referenceImage ? referenceImage.split(',')[1] || undefined : undefined;
      if (useWebSocketLive) {
        try {
          await ensureWsConnected(activeSessionId);
          response = await liveWsRef.current.sendMessage(message, {
            screenshotBase64,
            onDelta: (_chunk, aggregate) => updateLatestAssistantMessage(aggregate),
          });
        } catch (wsError: any) {
          setIsWsConnected(false);
          // fallback to HTTP flow automatically when websocket path fails
          if (useStreamingReplies) {
            let aggregateReply = '';
            response = await apiClient.sendLiveMessageStream(
              {
                sessionId: activeSessionId,
                message,
                screenshotBase64,
              },
              {
                signal: controller.signal,
                onDelta: (chunk) => {
                  aggregateReply += chunk;
                  updateLatestAssistantMessage(aggregateReply);
                },
              },
            );
          } else {
            response = await apiClient.sendLiveMessage(
              {
                sessionId: activeSessionId,
                message,
                screenshotBase64,
              },
              {
                signal: controller.signal,
              },
            );
            updateLatestAssistantMessage(response.reply);
          }
          setStatusMessage(`WebSocket unavailable, switched to HTTP mode. ${wsError?.message || ''}`.trim());
        }
      } else if (useStreamingReplies) {
        let aggregateReply = '';
        response = await apiClient.sendLiveMessageStream(
          {
            sessionId: activeSessionId,
            message,
            screenshotBase64,
          },
          {
            signal: controller.signal,
            onDelta: (chunk) => {
              aggregateReply += chunk;
              updateLatestAssistantMessage(aggregateReply);
            },
          },
        );
      } else {
        response = await apiClient.sendLiveMessage(
          {
            sessionId: activeSessionId,
            message,
            screenshotBase64,
          },
          {
            signal: controller.signal,
          },
        );
        updateLatestAssistantMessage(response.reply);
      }

      setStatusMessage(response.reply);
      if (realtimeReply) {
        setIntakeTranscript((prev) => [
          ...prev,
          { role: 'assistant', content: `[Realtime] ${realtimeReply}` },
        ]);
      }
      if (speakAgentReplies && !useWebSocketLive) {
        speakWithBrowserTts(response.reply);
      }

      if (response.liveIntent.readyForStoryGeneration) {
        setWorkflowStageOverride('STORY_GENERATION');
      } else {
        setWorkflowStageOverride('INTAKE');
      }
      const session = await refreshLoadedSession(activeSessionId);
      setSessionLookupId(session.sessionId);
      await handleRefreshSessionList();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        setIntakeTranscript((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === 'assistant' && !next[i].content) {
              next[i] = { ...next[i], content: '[Interrupted]' };
              break;
            }
          }
          return next;
        });
        setStatusMessage('Previous intake request interrupted.');
      } else {
        setStatusMessage(error.message || 'Unable to send intake message');
      }
    } finally {
      if (intakeAbortRef.current === controller) {
        intakeAbortRef.current = null;
      }
      setIsAgentTyping(false);
      setIsSendingIntake(false);
    }
  };

  const handleInterruptIntake = () => {
    intakeAbortRef.current?.abort();
    if (useWebSocketLive) {
      liveWsRef.current?.interrupt();
    }
    stopWsAudioPlayback();
    clearWsVoiceFallbackTimer();
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setIsSendingIntake(false);
    setIsAgentTyping(false);
    setStatusMessage('Intake interrupted. You can send a new message now.');
  };

  const handleStartAudioStream = async () => {
    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const { session } = await apiClient.createSession(intakeMessage.trim() || 'Live voice intake');
        activeSessionId = session.sessionId;
        setSessionId(activeSessionId);
        setSessionLookupId(activeSessionId);
      }
      await ensureWsConnected(activeSessionId);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioMediaStreamRef.current = stream;
      const usingPcmPath = await startPcmStreaming(stream);
      if (!usingPcmPath) {
        const preferredType = (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType: preferredType });
        audioMediaRecorderRef.current = recorder;
        recorder.ondataavailable = async (event: BlobEvent) => {
          if (!event.data || event.data.size === 0 || !liveWsRef.current) return;
          const file = new File([event.data], `chunk-${Date.now()}.webm`, {
            type: event.data.type || preferredType,
          });
          const base64WithPrefix = await fileToBase64(file);
          const base64 = base64WithPrefix.replace(/^data:.*;base64,/, '');
          liveWsRef.current.sendAudioChunk(base64, {
            mimeType: event.data.type || preferredType,
            encoding: 'webm_opus',
            chunkSize: event.data.size,
          });
          setMicChunksSent((prev) => prev + 1);
        };
        recorder.start(1200);
      } else {
        audioMediaRecorderRef.current = null;
      }
      setMicChunksSent(0);
      setAudioBytesReceived(0);
      setLastBackendAudioAckBytes(0);
      await startVoiceActivityDetection(stream);
      setIsAudioStreaming(true);
      setStatusMessage(
        usingPcmPath
          ? 'Voice stream started (PCM 16k). Replies are automatic after you pause.'
          : 'Voice stream started (webm fallback). Replies are automatic after you pause.',
      );
    } catch (error: any) {
      setStatusMessage(error?.message || 'Unable to start voice stream');
      setIsAudioStreaming(false);
    }
  };

  const handleCommitAudioTurn = () => {
    if (!liveWsRef.current) return;
    liveWsRef.current.commitAudio();
    setStatusMessage('Processing your spoken request...');
  };

  const handleStopAudioStream = () => {
    try {
      if (audioMediaRecorderRef.current && audioMediaRecorderRef.current.state !== 'inactive') {
        audioMediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
    audioMediaRecorderRef.current = null;
    stopPcmStreaming();
    if (audioMediaStreamRef.current) {
      audioMediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    audioMediaStreamRef.current = null;
    stopVoiceActivityDetection();
    setIsAudioStreaming(false);
  };

  const handleStartCameraStream = async () => {
    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const { session } = await apiClient.createSession(intakeMessage.trim() || 'Live camera intake');
        activeSessionId = session.sessionId;
        setSessionId(activeSessionId);
        setSessionLookupId(activeSessionId);
      }
      await ensureWsConnected(activeSessionId);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      cameraVideoRef.current = video;

      const canvas = document.createElement('canvas');
      cameraIntervalRef.current = window.setInterval(() => {
        if (!cameraVideoRef.current || !liveWsRef.current) return;
        const width = cameraVideoRef.current.videoWidth || 640;
        const height = cameraVideoRef.current.videoHeight || 360;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(cameraVideoRef.current, 0, 0, width, height);
        const frameBase64 = canvas.toDataURL('image/jpeg', 0.6).replace(/^data:image\/jpeg;base64,/, '');
        liveWsRef.current.sendVisionFrame(frameBase64);
      }, 1200);
      setIsCameraStreaming(true);
      setStatusMessage('Camera stream started. The live agent now receives visual context.');
    } catch (error: any) {
      setStatusMessage(error?.message || 'Unable to start camera stream');
      setIsCameraStreaming(false);
    }
  };

  const handleStopCameraStream = () => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    cameraVideoRef.current = null;
    setIsCameraStreaming(false);
  };

  const handleStartListening = () => {
    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      setStatusMessage('Speech recognition is not supported in this browser.');
      return;
    }

    if (intakeRecognitionRef.current) {
      try {
        intakeRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      intakeRecognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    setIsListeningIntake(true);
    intakeRecognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results || [])
        .map((result: any) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) setIntakeMessage(transcript);
    };
    recognition.onerror = () => {
      setStatusMessage('Voice capture failed. Please type your message.');
      setIsListeningIntake(false);
    };
    recognition.onend = () => {
      setIsListeningIntake(false);
      if (intakeRecognitionRef.current === recognition) {
        intakeRecognitionRef.current = null;
      }
    };

    recognition.start();
  };

  const handleStopListening = () => {
    if (!intakeRecognitionRef.current) return;
    try {
      intakeRecognitionRef.current.stop();
    } catch {
      // ignore stop errors
    } finally {
      intakeRecognitionRef.current = null;
      setIsListeningIntake(false);
    }
  };

  const playNarrationAudio = (text?: string) => {
    if (!text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors
    }
  };

  const handleRegenerateStoryBlock = async (
    blockType: 'text' | 'narration' | 'caption' | 'cta',
    blockIndex: number,
    title?: string,
    currentContent?: string,
  ) => {
    const id = (loadedSession?.sessionId || sessionId || sessionLookupId).trim();
    if (!id) return;
    setIsRegeneratingBlock(true);
    try {
      await apiClient.regenerateStoryBlock({
        sessionId: id,
        blockType,
        blockIndex,
        title,
        currentContent,
      });
      const session = await refreshLoadedSession(id);
      setSessionLookupId(session.sessionId);
      setStatusMessage(`Regenerated ${title || blockType} block.`);
    } catch (error: any) {
      setStatusMessage(error.message || `Unable to regenerate ${blockType} block`);
    } finally {
      setIsRegeneratingBlock(false);
    }
  };

  const startProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    // Final key check before spending tokens
    const keySelected = await hasAnyUsableApiKey();
    if (!keySelected) {
      setShowKeyDialog(true);
      return;
    }

    setState(AppState.GENERATING_IMAGE);
    setIsGifGenerating(false);
    if (videoSrc && videoSrc.startsWith('blob:')) URL.revokeObjectURL(videoSrc);
    setVideoSrc(null);
    setImageSrc(null);
    
    const styleToUse = inputStyle.trim() || getRandomStyle();
    setStatusMessage(`Designing "${inputText}"...`);
    setWorkflowStageOverride('INTAKE');

    let activeSessionId = sessionId;
    try {
      if (!activeSessionId) {
        const { session } = await apiClient.createSession(inputText);
        activeSessionId = session.sessionId;
        setSessionId(session.sessionId);
      }
      if (activeSessionId) {
        const intakeResponse = await apiClient.sendLiveMessage({
          sessionId: activeSessionId,
          message: inputText,
          screenshotBase64: referenceImage ? referenceImage.split(',')[1] || undefined : undefined,
        });
        setIntakeTranscript((prev) => [
          ...prev,
          { role: 'user', content: inputText },
          { role: 'assistant', content: intakeResponse.reply },
        ]);
        if (!intakeResponse.liveIntent.readyForStoryGeneration) {
          setStatusMessage(intakeResponse.reply);
          setState(AppState.IDLE);
          setWorkflowStageOverride('INTAKE');
          return;
        }
        setWorkflowStageOverride('STORY_GENERATION');
      }
    } catch (backendError) {
      console.warn('Backend workflow unavailable, continuing local generation.', backendError);
    }

    try {
      let resolvedImageUrl: string | undefined;
      let resolvedVideoUrl: string | undefined;
      let screenshotBase64 = 'ZmFrZQ==';

      if (activeSessionId) {
        try {
          await apiClient.generateStoryStream({
            sessionId: activeSessionId,
            text: inputText,
            style: styleToUse,
            typographyPrompt: typographyPrompt,
            referenceImage: referenceImage || undefined,
            generateAssets: true,
          }, {
            onStatus: (message) => setStatusMessage(message),
            onBlock: (block) => setStatusMessage(`Generated ${block.type}: ${block.title}`),
          });
          const refreshed = await refreshLoadedSession(activeSessionId);
          resolvedImageUrl = getStoryAssetUrl(refreshed, 'image');
          resolvedVideoUrl = getStoryAssetUrl(refreshed, 'video');
          if (resolvedImageUrl) {
            setImageSrc(resolvedImageUrl);
            if (resolvedImageUrl.startsWith('data:')) {
              screenshotBase64 = resolvedImageUrl.split(',')[1] || screenshotBase64;
            }
          }
        } catch (backendError) {
          console.warn('Backend storyteller generation unavailable, fallback to local media generation.', backendError);
        }
      }

      if (!resolvedVideoUrl) {
        const { data: b64Image, mimeType } = await generateTextImage({
          text: inputText,
          style: styleToUse,
          typographyPrompt: typographyPrompt,
          referenceImage: referenceImage || undefined,
        });

        resolvedImageUrl = `data:${mimeType};base64,${b64Image}`;
        screenshotBase64 = b64Image;
        setImageSrc(resolvedImageUrl);
        setState(AppState.GENERATING_VIDEO);
        setStatusMessage("Animating...");

        resolvedVideoUrl = await generateTextVideo(inputText, b64Image, mimeType, styleToUse);
      }

      if (resolvedVideoUrl) {
        setVideoSrc(resolvedVideoUrl);
      }
      setState(AppState.PLAYING);
      setStatusMessage("Done.");

      if (activeSessionId) {
        try {
          const orchestrated = await apiClient.runOrchestrator({
            sessionId: activeSessionId,
            text: inputText,
            style: styleToUse,
            typographyPrompt: typographyPrompt,
            referenceImage: referenceImage || undefined,
            imageUrl: resolvedImageUrl,
            videoUrl: resolvedVideoUrl,
            generateAssets: false,
            screenshotBase64,
            screenRecordingBase64: screenRecording ? screenRecording.split(',')[1] || undefined : undefined,
            targetUrl: navigatorTargetUrl.trim() || undefined,
            mode: navigatorMode,
            headless: true,
          });
          setWorkflowStageOverride('COMPLETION');
          setLoadedSession(orchestrated.session);
          setStatusMessage(orchestrated.completionReply || 'Workflow completed.');
          setIntakeTranscript((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: orchestrated.completionReply,
            },
          ]);
          if (orchestrated.executionResult.status !== 'success') {
            setStatusMessage(
              `${orchestrated.completionReply} (Execution status: ${orchestrated.executionResult.status})`,
            );
          }
          const session = await refreshLoadedSession(activeSessionId);
          setSessionLookupId(session.sessionId);
        } catch (backendError) {
          console.warn('Failed to sync navigator workflow stages.', backendError);
        }
      }
    } catch (err: any) {
      console.error(err);
      const msg = err.message || "";
      if (msg.includes("Requested entity was not found") || msg.includes("404")) {
        setShowKeyDialog(true);
        setState(AppState.IDLE);
      } else {
        setStatusMessage(msg || "Something went wrong creating your art.");
        setState(AppState.ERROR);
      }
    }
  };

  const reset = () => {
    if (liveRealtimeSessionId) {
      apiClient.stopRealtimeLiveSession(liveRealtimeSessionId).catch(() => undefined);
    }
    handleStopAudioStream();
    handleStopCameraStream();
    stopWsAudioPlayback();
    wsAudioBufferRef.current = null;
    clearWsVoiceFallbackTimer();
    liveWsRef.current?.close();
    setWsConnectionId('');
    setWsActiveModel('');
    setIsWsConnected(false);
    setState(AppState.IDLE);
    setVideoSrc(null);
    setImageSrc(null);
    setIsGifGenerating(false);
    setSessionId(null);
    setWorkflowStageOverride(null);
    setLoadedSession(null);
    setSessionLookupId("");
    setIntakeTranscript([]);
    setScreenRecording(null);
    setLiveRealtimeSessionId(null);
    setUseRealtimeLive(false);
    setIsAudioStreaming(false);
    setIsCameraStreaming(false);
  };

  const handleDownload = () => {
    if (videoSrc) {
      const a = document.createElement('a');
      a.href = videoSrc;
      a.download = `typemotion-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleDownloadGif = async () => {
    if (!videoSrc) return;
    setIsGifGenerating(true);
    try {
      const gifBlob = await createGifFromVideo(videoSrc);
      const gifUrl = URL.createObjectURL(gifBlob);
      const a = document.createElement('a');
      a.href = gifUrl;
      a.download = `typemotion-${Date.now()}.gif`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(gifUrl);
    } catch (error) {
      alert("Could not generate GIF from this video.");
    } finally {
      setIsGifGenerating(false);
    }
  };

  const renderAppContent = () => {
    if (state === AppState.ERROR) {
       return (
        <div className="flex flex-col items-center justify-center space-y-6 h-full p-8 text-center animate-in zoom-in-95">
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-xl border border-red-100 dark:border-red-900/30 max-w-md shadow-sm">
            <p className="font-medium">Generation Failed</p>
            <p className="text-sm mt-1 text-red-500 dark:text-red-400">{statusMessage}</p>
          </div>
          <button onClick={reset} className="px-8 py-3 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium rounded-full hover:bg-stone-800 dark:hover:bg-white transition-colors shadow-lg">
            Try Again
          </button>
        </div>
      );
    }

    if (state === AppState.GENERATING_IMAGE || state === AppState.GENERATING_VIDEO || state === AppState.PLAYING) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 md:p-8 bg-stone-50 dark:bg-zinc-950">
          <div className={`flex items-center gap-3 px-5 py-2 rounded-full mb-6 transition-all duration-500 ${state === AppState.PLAYING ? 'opacity-0 h-0 mb-0 overflow-hidden' : 'bg-white dark:bg-zinc-900 shadow-sm border border-stone-100 dark:border-zinc-800'}`}>
             <Loader2 size={16} className="animate-spin text-stone-400 dark:text-stone-500" />
             <span className="text-sm font-medium text-stone-600 dark:text-stone-300 uppercase tracking-wide">{statusMessage}</span>
          </div>
          <div className="relative w-full max-w-6xl aspect-video bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-stone-900/5 dark:ring-white/10 group">
            {(state === AppState.GENERATING_IMAGE) && !imageSrc && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-stone-50 dark:bg-zinc-900 space-y-6">
                 <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-4 border-stone-200 dark:border-zinc-800 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-stone-900 dark:border-stone-100 rounded-full border-t-transparent animate-spin"></div>
                 </div>
                 <p className="text-stone-400 dark:text-stone-500 font-medium animate-pulse text-sm">Designing Typography...</p>
              </div>
            )}
            {imageSrc && !videoSrc && <img src={imageSrc} alt="Text Visualized" className="w-full h-full object-cover animate-in fade-in duration-1000" />}
            {imageSrc && state === AppState.GENERATING_VIDEO && (
               <div className="absolute inset-0 bg-white/30 dark:bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center space-y-6 z-10 transition-all">
                  <div className="bg-white dark:bg-zinc-800 p-3 rounded-full shadow-xl">
                     <Loader2 className="w-6 h-6 text-stone-900 dark:text-white animate-spin" />
                  </div>
               </div>
             )}
            {videoSrc && <video src={videoSrc} autoPlay loop playsInline controls className="w-full h-full object-cover animate-in fade-in duration-1000" />}
          </div>
          {state === AppState.PLAYING && (
            <div className="w-full max-w-6xl mt-6 flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-bottom-4 fade-in duration-700">
              <button onClick={reset} className="flex items-center gap-2 px-6 py-3 text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-zinc-800 rounded-xl transition-all font-bold text-sm uppercase tracking-wide group">
                <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                Create Another
              </button>
              <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-end">
               <button onClick={handleDownloadGif} disabled={isGifGenerating} className="px-5 py-3 bg-white dark:bg-zinc-900 text-stone-900 dark:text-stone-200 border border-stone-200 dark:border-zinc-700 font-bold rounded-xl hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-50 text-sm">
                {isGifGenerating ? <Loader2 size={16} className="animate-spin" /> : <FileType size={16} />} GIF
              </button>
               <button onClick={handleDownload} className="px-6 py-3 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-bold rounded-xl hover:bg-stone-800 dark:hover:bg-white transition-colors flex items-center gap-2 shadow-xl shadow-stone-900/10 dark:shadow-white/5 active:scale-[0.98] text-sm">
                <Download size={16} /> Download MP4
              </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="h-full overflow-y-auto custom-scrollbar p-6 md:p-8 bg-white dark:bg-zinc-950">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-stone-900 dark:text-white">Create New</h2>
        </div>

        <form onSubmit={startProcess} className="space-y-6">
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-900 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-zinc-400">Session Controls</p>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-stone-500 dark:text-zinc-400 uppercase tracking-wide">Live Intake Agent</p>
              <div className="max-h-28 overflow-y-auto bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg p-2 space-y-1">
                {intakeTranscript.length === 0 && (
                  <p className="text-xs text-stone-400 dark:text-zinc-500">No intake messages yet. Send your campaign request to begin.</p>
                )}
                {intakeTranscript.slice(-6).map((msg, idx) => (
                  <p key={idx} className={`text-xs ${msg.role === 'user' ? 'text-stone-700 dark:text-zinc-200' : 'text-stone-500 dark:text-zinc-400'}`}>
                    <span className="font-semibold">{msg.role === 'user' ? 'You:' : 'Agent:'}</span> {msg.content}
                  </p>
                ))}
                {isAgentTyping && (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    <span className="font-semibold">Agent:</span> typing...
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  type="text"
                  value={intakeMessage}
                  onChange={(e) => setIntakeMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendIntakeMessage();
                    }
                  }}
                  placeholder="Tell the live agent your campaign objective..."
                  className="md:col-span-3 w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleSendIntakeMessage}
                  disabled={!intakeMessage.trim() || isSendingIntake}
                  className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSendingIntake ? <Loader2 size={14} className="animate-spin" /> : null}
                  Send
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleStartListening}
                  disabled={isListeningIntake}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isListeningIntake ? 'Listening...' : 'Use Mic (optional)'}
                </button>
                <button
                  type="button"
                  onClick={handleStopListening}
                  disabled={!isListeningIntake}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  Stop Mic
                </button>
                <button
                  type="button"
                  onClick={handleStartAudioStream}
                  disabled={isAudioStreaming || !useWebSocketLive}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isAudioStreaming ? 'Voice Stream: On' : 'Start Voice Stream'}
                </button>
                <button
                  type="button"
                  onClick={handleCommitAudioTurn}
                  disabled={!isAudioStreaming || !useWebSocketLive}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  Commit Voice Turn
                </button>
                <button
                  type="button"
                  onClick={handleStopAudioStream}
                  disabled={!isAudioStreaming}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  Stop Voice Stream
                </button>
                <button
                  type="button"
                  onClick={handleStartCameraStream}
                  disabled={isCameraStreaming || !useWebSocketLive}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isCameraStreaming ? 'Camera: On' : 'Start Camera Stream'}
                </button>
                <button
                  type="button"
                  onClick={handleStopCameraStream}
                  disabled={!isCameraStreaming}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  Stop Camera Stream
                </button>
                <button
                  type="button"
                  onClick={handleInterruptIntake}
                  disabled={!isSendingIntake}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300 text-xs font-semibold hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                >
                  Interrupt Agent
                </button>
                <button
                  type="button"
                  onClick={() => setUseStreamingReplies((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800"
                >
                  {useStreamingReplies ? 'Streaming: On' : 'Streaming: Off'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseWebSocketLive((prev) => !prev);
                    if (useWebSocketLive) {
                      handleStopAudioStream();
                      handleStopCameraStream();
                      stopWsAudioPlayback();
                      wsAudioBufferRef.current = null;
                      clearWsVoiceFallbackTimer();
                      liveWsRef.current?.close();
                      setWsConnectionId('');
                      setWsActiveModel('');
                      setIsWsConnected(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800"
                >
                  {useWebSocketLive ? `Transport: WebSocket${isWsConnected ? ' (Connected)' : ''}` : 'Transport: HTTP'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !speakAgentReplies;
                    setSpeakAgentReplies(next);
                    if (next) {
                      setStatusMessage('Agent voice enabled. Live listening will start automatically.');
                    } else {
                      stopWsAudioPlayback();
                      wsAudioBufferRef.current = null;
                      clearWsVoiceFallbackTimer();
                      if ('speechSynthesis' in window) {
                        try {
                          window.speechSynthesis.cancel();
                        } catch {
                          // ignore
                        }
                      }
                      if (isAudioStreaming) {
                        handleStopAudioStream();
                      }
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800"
                >
                  {speakAgentReplies ? 'Agent Voice: On' : 'Agent Voice: Off'}
                </button>
                <button
                  type="button"
                  onClick={handleStartRealtimeLive}
                  disabled={isRealtimeConnecting}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  {isRealtimeConnecting ? 'Connecting...' : (useRealtimeLive ? 'Realtime: On' : 'Realtime: Off')}
                </button>
                <button
                  type="button"
                  onClick={handleStopRealtimeLive}
                  disabled={!useRealtimeLive}
                  className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  Stop Realtime
                </button>
                {wsClientId ? (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">Client ID: {wsClientId}</p>
                ) : null}
                {wsConnectionId ? (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">Connection ID: {wsConnectionId}</p>
                ) : null}
                {wsActiveModel ? (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">Active model: {wsActiveModel}</p>
                ) : null}
                <p className="text-xs text-stone-500 dark:text-zinc-400">Mic chunks sent: {micChunksSent}</p>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Audio bytes received: {audioBytesReceived}
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Last backend audio ack: {lastBackendAudioAckBytes} bytes
                </p>
                {loadedSession?.liveIntent?.missingFields && loadedSession.liveIntent.missingFields.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Missing fields: {loadedSession.liveIntent.missingFields.join(', ')}
                  </p>
                )}
                {typeof loadedSession?.liveIntent?.confidence === 'number' && (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Live intent confidence: {Math.round((loadedSession.liveIntent.confidence || 0) * 100)}%
                  </p>
                )}
                {loadedSession?.liveIntent?.needs && loadedSession.liveIntent.needs.length > 0 && (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Needs: {loadedSession.liveIntent.needs.join(', ')}
                  </p>
                )}
                {loadedSession?.liveIntent?.interests && loadedSession.liveIntent.interests.length > 0 && (
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Interests: {loadedSession.liveIntent.interests.join(', ')}
                  </p>
                )}
                {loadedSession?.completionFeedback && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Completion feedback: {loadedSession.completionFeedback}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                value={sessionLookupId}
                onChange={(e) => setSessionLookupId(e.target.value)}
                placeholder="Paste existing session ID"
                className="md:col-span-2 w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-white"
              />
              <button
                type="button"
                onClick={handleLoadSession}
                disabled={!sessionLookupId.trim() || isLoadingSession}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoadingSession ? <Loader2 size={14} className="animate-spin" /> : null}
                Load Session
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  setSessionLookupId(id);
                }}
                className="md:col-span-2 w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-white"
              >
                <option value="">Select from recent sessions</option>
                {recentSessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {session.sessionId.slice(0, 8)}... | {session.workflowStage} | {session.status}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleRefreshSessionList}
                disabled={isRefreshingSessions}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isRefreshingSessions ? <Loader2 size={14} className="animate-spin" /> : null}
                Refresh List
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="url"
                value={navigatorTargetUrl}
                onChange={(e) => setNavigatorTargetUrl(e.target.value)}
                placeholder="Navigator target URL (for playwright mode)"
                className="w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-white"
              />
              <select
                value={navigatorMode}
                onChange={(e) => setNavigatorMode(e.target.value as 'mock' | 'playwright')}
                className="w-full bg-white dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-white"
              >
                <option value="mock">Navigator Mode: mock</option>
                <option value="playwright">Navigator Mode: playwright</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleRestartFromReview}
                disabled={isRestartingSession || !(loadedSession?.sessionId || sessionId || sessionLookupId).trim()}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isRestartingSession ? <Loader2 size={14} className="animate-spin" /> : null}
                Restart From Review
              </button>
              <button
                type="button"
                onClick={handleRerunNavigator}
                disabled={isRerunningNavigator || !(loadedSession?.sessionId || sessionId || sessionLookupId).trim()}
                className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-semibold hover:bg-stone-800 dark:hover:bg-white disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isRerunningNavigator ? <Loader2 size={14} className="animate-spin" /> : null}
                Re-run Navigator
              </button>
            </div>
            {loadedSession && (
              <div className="text-xs text-stone-600 dark:text-zinc-300 space-y-1">
                <p>
                  Loaded {loadedSession.sessionId} | stage: {loadedSession.workflowStage} | status: {loadedSession.status} | logs: {loadedSession.logs.length}
                </p>
                {loadedSession.executionResult && (
                  <div className="space-y-1">
                    <p>
                      Last execution: {loadedSession.executionResult.status} | completed actions: {loadedSession.executionResult.completedActions}
                      {loadedSession.executionResult.error ? ` | error: ${loadedSession.executionResult.error}` : ''}
                    </p>
                    {loadedSession.executionResult.steps.some((step) => step.status === 'failed') && (
                      <p>
                        Failed steps: {loadedSession.executionResult.steps.filter((step) => step.status === 'failed').length}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {loadedSession?.storyOutput && (
              <div className="space-y-2 border-t border-stone-200 dark:border-zinc-800 pt-2">
                <p className="text-[11px] font-semibold text-stone-500 dark:text-zinc-400 uppercase tracking-wide">Story Output</p>
                <p className="text-xs font-semibold text-stone-700 dark:text-zinc-200">{loadedSession.storyOutput.title}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {loadedSession.storyOutput.blocks.map((block, idx) => (
                    <div key={`${block.type}-${idx}`} className="rounded-lg border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-stone-400 dark:text-zinc-500">{block.type}</p>
                      <p className="text-xs font-semibold text-stone-700 dark:text-zinc-200">{block.title}</p>
                      {block.content && <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">{block.content}</p>}
                      {block.assetUrl && (
                        <a className="text-xs underline text-stone-600 dark:text-zinc-300 mt-1 inline-block" href={block.assetUrl} target="_blank" rel="noreferrer">
                          Open asset
                        </a>
                      )}
                      {block.type === 'audio' && block.content && (
                        <button
                          type="button"
                          onClick={() => playNarrationAudio(block.content)}
                          className="mt-2 px-2 py-1 rounded border border-stone-300 dark:border-zinc-700 text-[10px] font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800"
                        >
                          Play narration
                        </button>
                      )}
                      {(block.type === 'text' || block.type === 'narration' || block.type === 'caption' || block.type === 'cta') && (
                        <button
                          type="button"
                          onClick={() =>
                            handleRegenerateStoryBlock(
                              block.type as 'text' | 'narration' | 'caption' | 'cta',
                              idx,
                              block.title,
                              block.content,
                            )
                          }
                          disabled={isRegeneratingBlock}
                          className="mt-2 px-2 py-1 rounded border border-stone-300 dark:border-zinc-700 text-[10px] font-semibold hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {isRegeneratingBlock ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Type size={14} /> Content
                </label>
                <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Enter text..." maxLength={40} className="w-full bg-stone-50 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 transition-all placeholder-stone-300 dark:placeholder-zinc-700 text-stone-900 dark:text-white" required />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-stone-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                    <Wand2 size={14} /> Art Direction
                  </label>
                  <button type="button" onClick={async () => {
                    setIsSuggestingStyle(true);
                    const suggestion = await generateStyleSuggestion(inputText);
                    if (suggestion) setInputStyle(suggestion);
                    setIsSuggestingStyle(false);
                  }} disabled={!inputText.trim() || isSuggestingStyle} className="text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 flex items-center gap-1 transition-colors disabled:opacity-50">
                      {isSuggestingStyle ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {isSuggestingStyle ? 'Thinking...' : 'Suggest'}
                  </button>
                </div>
                <textarea value={inputStyle} onChange={(e) => setInputStyle(e.target.value)} placeholder="e.g. 'Made of clouds in a blue sky'..." className="w-full bg-stone-50 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 transition-all placeholder-stone-300 dark:placeholder-zinc-700 text-stone-900 dark:text-white resize-none h-24" />
              </div>
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Paintbrush size={14} /> Typography
                </label>
                <textarea value={typographyPrompt} onChange={(e) => setTypographyPrompt(e.target.value)} placeholder="Font style..." className="w-full bg-stone-50 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 transition-all placeholder-stone-300 dark:placeholder-zinc-700 text-stone-900 dark:text-white resize-none h-24" />
                <div className="flex flex-wrap gap-1.5">
                  {TYPOGRAPHY_SUGGESTIONS.slice(0, 4).map((opt) => (
                    <button key={opt.id} type="button" onClick={() => setTypographyPrompt(opt.prompt)} className="px-2 py-1 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 text-stone-600 dark:text-stone-300 text-[10px] font-medium rounded-md border border-stone-200 dark:border-zinc-700">{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-stone-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <ImageIcon size={14} /> Ref Image
                </label>
                <div className="flex items-center gap-3">
                   <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()} 
                    className="flex-1 border border-dashed border-stone-300 dark:border-zinc-700 rounded-xl h-10 flex items-center justify-center gap-2 text-stone-500 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 cursor-pointer text-xs transition-all"
                    aria-label="Upload reference image"
                   >
                    <Upload size={14} /> Upload
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setReferenceImage(await fileToBase64(file));
                    }} 
                    accept="image/*" 
                    className="sr-only" 
                  />
                   {referenceImage && (
                    <div className="h-10 w-10 relative rounded overflow-hidden border border-stone-200 dark:border-zinc-700 group">
                       <img src={referenceImage} alt="Reference thumbnail" className="w-full h-full object-cover" />
                       <button 
                        type="button" 
                        onClick={() => setReferenceImage(null)} 
                        className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        aria-label="Remove reference image"
                       >
                        <X size={12} className="text-white" />
                       </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => recordingInputRef.current?.click()}
                    className="flex-1 border border-dashed border-stone-300 dark:border-zinc-700 rounded-xl h-10 flex items-center justify-center gap-2 text-stone-500 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 cursor-pointer text-xs transition-all"
                    aria-label="Upload screen recording"
                  >
                    <Upload size={14} /> Upload Screen Recording
                  </button>
                  <input
                    type="file"
                    ref={recordingInputRef}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setScreenRecording(await fileToBase64(file));
                    }}
                    accept="video/*"
                    className="sr-only"
                  />
                  {screenRecording && (
                    <button
                      type="button"
                      onClick={() => setScreenRecording(null)}
                      className="h-10 px-3 rounded-xl border border-stone-200 dark:border-zinc-700 text-xs text-stone-500 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800"
                    >
                      Remove video
                    </button>
                  )}
                </div>
                <p className="text-[10px] leading-relaxed text-stone-400 dark:text-zinc-500 mt-3 border-t border-stone-100 dark:border-zinc-900 pt-3">
                  By using this feature, you confirm that you have the necessary rights to any content that you upload. Do not generate content that infringes on others’ intellectual property or privacy rights. Your use of this generative AI service is subject to our <a href="https://policies.google.com/terms/generative-ai/use-policy" target="_blank" rel="noopener noreferrer" className="underline hover:text-stone-600 dark:hover:text-stone-300">Prohibited Use Policy</a>.
                  <br/><br/>
                  Please note that uploads from Google Workspace may be used to develop and improve Google products and services in accordance with our <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-stone-600 dark:hover:text-stone-300">terms</a>.
                </p>
              </div>
            </div>
          </div>
          <div className="pt-4 border-t border-stone-100 dark:border-zinc-800">
            <button type="submit" disabled={!inputText.trim()} className="w-full py-4 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-bold rounded-xl hover:bg-stone-800 dark:hover:bg-white transition-all disabled:opacity-50 shadow-xl shadow-stone-900/10 dark:shadow-white/5 active:scale-[0.99] flex items-center justify-center gap-2">
              <Play size={18} className="fill-current" /> GENERATE
            </button>
          </div>
        </form>
      </div>
    );
  };

  const isFlip = viewMode === 'create';

  return (
    <div className="min-h-screen w-full flex flex-col bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-stone-100 font-sans transition-colors duration-500 overflow-x-hidden selection:bg-stone-900 selection:text-white dark:selection:bg-white dark:selection:text-stone-900">
      <ApiKeyDialog isOpen={showKeyDialog} onClose={() => setShowKeyDialog(false)} onSelect={handleSelectKey} canUseAiStudio={canUseAiStudio} hasEnvKey={hasEnvKey} />
      <div className="w-full flex justify-center">
        <WorkflowProgress activeStage={computedWorkflowViewState.stage} progressPercent={computedWorkflowViewState.progressPercent} />
      </div>

      <div className="flex-1 flex items-center justify-center p-4 lg:p-6 overflow-hidden">
        <div className={`transition-all duration-1000 ease-[cubic-bezier(0.25,0.8,0.25,1)] w-full flex flex-col lg:flex-row items-center justify-center ${isFlip ? 'max-w-6xl gap-0 lg:gap-0' : 'max-w-7xl gap-8 lg:gap-16'}`}>
          <div className={`flex flex-col justify-center space-y-6 lg:space-y-8 z-10 text-center lg:text-left transition-all duration-1000 ease-[cubic-bezier(0.25,0.8,0.25,1)] origin-center overflow-hidden flex-shrink-0 ${isFlip ? 'max-h-0 opacity-0 -translate-y-24 lg:max-h-[900px] lg:w-0 lg:-translate-y-0 lg:-translate-x-32' : 'max-h-[1000px] opacity-100 translate-y-0 lg:w-5/12 lg:translate-x-0'}`}>
             <div className="min-w-[300px] lg:w-[480px]">
                <div className="space-y-4 lg:space-y-6">
                  <div className="font-bold text-xl tracking-tight text-stone-900 dark:text-white flex items-center justify-center lg:justify-start gap-2">
                      <div className="w-8 h-8 bg-stone-900 dark:bg-white rounded-lg flex items-center justify-center">
                        <span className="text-white dark:text-stone-900 text-xs font-serif italic">T</span>
                      </div>
                      TypeMotion
                  </div>
                  <h1 className="text-4xl lg:text-5xl font-bold text-stone-900 dark:text-white tracking-tight leading-tight">Cinematic Motion <br/> <span className="text-stone-400 dark:text-zinc-600">Typography</span></h1>
                  <p className="text-lg text-stone-500 dark:text-stone-400 leading-relaxed max-w-md mx-auto lg:mx-0">Create stunning 3D text animations using generative AI. Turn simple words into cinematic masterpieces.</p>
               </div>
               <div className="pt-8 flex flex-col items-center lg:items-start">
                  <button onClick={handleMainCta} className="group px-8 py-4 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-lg font-bold rounded-xl hover:bg-stone-800 dark:hover:bg-white transition-all shadow-xl shadow-stone-900/20 dark:shadow-white/10 active:scale-95 flex items-center gap-3">
                    <VideoIcon size={20} className="group-hover:text-yellow-200 dark:group-hover:text-amber-500 transition-colors" /> Make your own
                  </button>
               </div>
             </div>
          </div>
          <div className={`relative z-20 [perspective:2000px] transition-all duration-1000 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${isFlip ? 'w-full h-[80vh] md:h-[85vh]' : 'w-full lg:w-7/12 h-[500px] lg:h-[600px]'}`}>
             <div className={`relative w-full h-full transition-all duration-1000 [transform-style:preserve-3d] shadow-2xl rounded-3xl ${isFlip ? '[transform:rotateY(180deg)]' : ''}`}>
                <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] bg-black rounded-3xl overflow-hidden border border-stone-800 dark:border-zinc-800">
                   <HeroCarousel forceMute={isFlip} />
                </div>
                <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] bg-white dark:bg-zinc-950 rounded-3xl overflow-hidden border border-stone-100 dark:border-zinc-800">
                   <button onClick={() => setViewMode('gallery')} className="absolute top-4 right-4 z-50 p-2 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 text-stone-500 dark:text-stone-400 rounded-full transition-colors" title="Back to Gallery"><X size={20} /></button>
                   {renderAppContent()}
                </div>
             </div>
          </div>
        </div>
      </div>
      <footer className="w-full py-6 text-center text-xs text-stone-400 dark:text-zinc-600 font-medium z-10">
        <a href="https://x.com/GeokenAI" target="_blank" rel="noopener noreferrer" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">Created by @GeokenAI</a>
      </footer>
    </div>
  );
};

export default App;
