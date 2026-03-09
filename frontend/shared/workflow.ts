import { WorkflowStage } from './contracts';

export interface WorkflowStageMeta {
  id: WorkflowStage;
  label: string;
  description: string;
}

export const WORKFLOW_STAGES: WorkflowStageMeta[] = [
  { id: 'INTAKE', label: 'Intake', description: 'Collect user goal and constraints.' },
  { id: 'STORY_GENERATION', label: 'Story Generation', description: 'Generate mixed-media creative assets.' },
  { id: 'STORY_REVIEW', label: 'Story Review', description: 'Review and refine outputs before publish.' },
  { id: 'NAVIGATOR_ANALYSIS', label: 'Navigator Analysis', description: 'Analyze target UI visually.' },
  { id: 'NAVIGATOR_EXECUTION', label: 'Navigator Execution', description: 'Execute publishing actions.' },
  { id: 'COMPLETION', label: 'Completion', description: 'Show final execution summary.' },
];
