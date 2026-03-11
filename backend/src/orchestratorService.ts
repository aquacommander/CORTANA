import { randomUUID } from 'node:crypto';
import {
  ExecutionResult,
  NavigatorPlan,
  Session,
  StoryOutput,
  WorkflowStage,
} from '../../frontend/shared/contracts.ts';
import { analyzeNavigatorTarget } from './navigatorAnalyzer.ts';
import { executeNavigatorPlan } from './navigatorExecutor.ts';
import { buildStoryOutput } from './storytellerService.ts';

type OrchestratorOptions = {
  text?: string;
  style?: string;
  typographyPrompt?: string;
  referenceImage?: string;
  imageUrl?: string;
  videoUrl?: string;
  generateAssets?: boolean;
  screenshotBase64?: string;
  screenRecordingBase64?: string;
  targetUrl?: string;
  mode?: 'mock' | 'playwright';
  headless?: boolean;
};

type OrchestratorDeps = {
  getKnowledgeContext: (query: string) => Promise<string>;
  appendLog: (session: Session, message: string) => void;
  moveStage: (session: Session, target: WorkflowStage) => void;
  ensureStage: (session: Session, target: WorkflowStage) => void;
  saveSession: (session: Session) => Promise<void>;
};

function buildCompletionReply(session: Session, executionResult: ExecutionResult): string {
  const platform = session.liveIntent?.platform || 'your target platform';
  if (executionResult.status === 'success') {
    return `Done. I generated and prepared your campaign assets, then completed the publish workflow on ${platform}. You can ask me to refine copy, visuals, or run another publish attempt.`;
  }
  return `I completed the orchestration but execution ended with status "${executionResult.status}". I can now revise the plan and retry with safer selectors or a different target path.`;
}

export async function runOrchestratedWorkflow(
  session: Session,
  options: OrchestratorOptions,
  deps: OrchestratorDeps,
): Promise<{
  storyOutput: StoryOutput;
  navigatorPlan: NavigatorPlan;
  executionResult: ExecutionResult;
  completionReply: string;
}> {
  deps.ensureStage(session, 'STORY_GENERATION');
  if (!session.liveIntent?.readyForStoryGeneration) {
    throw new Error('Live intent is incomplete. Continue intake conversation before orchestration.');
  }

  const storyOutput = await buildStoryOutput({
    sessionId: randomUUID(),
    goal: options.text?.trim() || session.goal,
    liveIntent: session.liveIntent,
    guidanceContext: await deps.getKnowledgeContext(
      `${options.text?.trim() || session.goal}\n${session.conversationSummary}\n${JSON.stringify(
        session.liveIntent || {},
      )}`,
    ),
    style: options.style,
    typographyPrompt: options.typographyPrompt,
    referenceImage: options.referenceImage,
    imageUrl: options.imageUrl,
    videoUrl: options.videoUrl,
    generateAssets: options.generateAssets ?? false,
  });
  session.storyOutput = storyOutput;
  deps.appendLog(session, 'Orchestrator: story output generated');
  deps.moveStage(session, 'STORY_REVIEW');
  deps.appendLog(session, 'Orchestrator: stage advanced to STORY_REVIEW');

  deps.moveStage(session, 'NAVIGATOR_ANALYSIS');
  deps.appendLog(session, 'Orchestrator: stage advanced to NAVIGATOR_ANALYSIS');
  const navigatorPlan = await analyzeNavigatorTarget({
    targetUrl: options.targetUrl,
    storyTitle: storyOutput.title || `Story for "${session.goal}"`,
    goal: session.goal,
    screenshotBase64: options.screenshotBase64,
    screenRecordingBase64: options.screenRecordingBase64,
    storyContext: {
      summary: storyOutput.blocks.find((block) => block.type === 'text' && block.title === 'Summary')?.content,
      script: storyOutput.blocks.find((block) => block.type === 'text' && block.title === 'Script')?.content,
      caption: storyOutput.blocks.find((block) => block.type === 'caption')?.content,
      cta: storyOutput.blocks.find((block) => block.type === 'cta')?.content,
      imageAssetUrl: storyOutput.blocks.find((block) => block.type === 'image')?.assetUrl,
      videoAssetUrl: storyOutput.blocks.find((block) => block.type === 'video')?.assetUrl,
      platform: session.liveIntent?.platform,
    },
  });
  session.navigatorPlan = navigatorPlan;
  deps.appendLog(session, 'Orchestrator: navigator analysis generated');

  deps.moveStage(session, 'NAVIGATOR_EXECUTION');
  deps.appendLog(session, 'Orchestrator: stage advanced to NAVIGATOR_EXECUTION');
  const selectedMode = options.mode || 'mock';
  const executionResult = await executeNavigatorPlan(navigatorPlan, {
    mode: selectedMode,
    targetUrl: options.targetUrl,
    headless: options.headless ?? true,
  });
  session.executionResult = executionResult;
  deps.appendLog(session, `Orchestrator: navigator actions executed (${selectedMode} mode)`);

  deps.moveStage(session, 'COMPLETION');
  session.status = executionResult.status === 'failed' ? 'failed' : 'completed';
  const completionReply = buildCompletionReply(session, executionResult);
  (session as any).completionFeedback = completionReply;
  deps.appendLog(session, 'Orchestrator: stage advanced to COMPLETION');
  deps.appendLog(session, `Orchestrator: completion feedback prepared (${executionResult.status})`);

  await deps.saveSession(session);

  return {
    storyOutput,
    navigatorPlan,
    executionResult,
    completionReply,
  };
}
