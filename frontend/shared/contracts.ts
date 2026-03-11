export type SessionStatus = 'active' | 'completed' | 'failed';

export type WorkflowStage =
  | 'INTAKE'
  | 'STORY_GENERATION'
  | 'STORY_REVIEW'
  | 'NAVIGATOR_ANALYSIS'
  | 'NAVIGATOR_EXECUTION'
  | 'COMPLETION';

export interface StoryBlock {
  type: 'text' | 'image' | 'video' | 'audio' | 'narration' | 'caption' | 'cta';
  title: string;
  content?: string;
  assetUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface StoryOutput {
  storyId: string;
  title: string;
  blocks: StoryBlock[];
  nextAction: string;
}

export interface LiveIntent {
  intent: string;
  objective: string;
  audience: string;
  tone: string;
  platform: string;
  needs?: string[];
  interests?: string[];
  unresolvedQuestions?: string[];
  readyForStoryGeneration: boolean;
  handoffTo: 'storyteller' | 'navigator' | 'none';
  missingFields?: Array<'objective' | 'audience' | 'tone' | 'platform'>;
  confidence?: number;
}

export interface NavigatorAction {
  action: 'click' | 'type' | 'upload_file' | 'scroll' | 'wait';
  target: string;
  value?: string;
  confidence: number;
  reason: string;
}

export interface NavigatorPlan {
  detectedElements: Array<{
    name: string;
    selectorHint: string;
    confidence: number;
  }>;
  actionPlan: NavigatorAction[];
  confidence: number;
  notes: string;
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'partial';
  steps: Array<{
    action: NavigatorAction['action'];
    target: string;
    status: 'success' | 'failed';
    note?: string;
  }>;
  logs: string[];
  error?: string;
  completedActions: number;
}

export interface Session {
  sessionId: string;
  goal: string;
  status: SessionStatus;
  workflowStage: WorkflowStage;
  navigatorTargetUrl?: string;
  conversationSummary: string;
  liveIntent?: LiveIntent;
  storyOutput?: StoryOutput;
  navigatorPlan?: NavigatorPlan;
  executionResult?: ExecutionResult;
  completionFeedback?: string;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}
