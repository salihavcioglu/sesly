import type { WorkflowDocument, WorkflowStep } from './workflow-model';

export type RunState = 'ready' | 'running' | 'done' | 'failed' | 'cancelled';
export interface RunItem {
  name: string;
  text: string;
  state: RunState;
  stepId?: string;
  error?: string;
  audio: Record<string, Blob>;
  texts?: Record<string, string>;
  sourceId?: string;
  outputStep?: string;
}
export interface WorkflowRun {
  version: 1;
  signature: string;
  updatedAt: number;
  items: RunItem[];
}
export interface ExecutionPlan {
  steps: WorkflowStep[];
  scripts: { name: string; text: string; sourceId?: string }[];
  signature: string;
}
export class WorkflowValidationError extends Error {
  constructor(readonly code: 'graph' | 'unsupported' | 'scripts' | 'voice' | 'media' | 'language') {
    super(code);
  }
}

/** Validate the entire graph before any side effect. Unsupported drafts never partially execute. */
export function compileWorkflow(document: WorkflowDocument, engine = ''): ExecutionPlan {
  const starts = document.steps.filter((step) => ['start', 'audio'].includes(step.kind));
  const ids = new Set(document.steps.map((step) => step.id));
  if (starts.length !== 1 || ids.size !== document.steps.length ||
    document.connections.some((edge) => !ids.has(edge.source) || !ids.has(edge.target)))
    throw new WorkflowValidationError('graph');
  const steps: WorkflowStep[] = [];
  let step: WorkflowStep | undefined = starts[0];
  while (step) {
    if (steps.includes(step)) throw new WorkflowValidationError('graph');
    steps.push(step);
    const outgoing = document.connections.filter((edge) => edge.source === step!.id);
    const incoming = document.connections.filter((edge) => edge.target === step!.id);
    if (outgoing.length > 1 || incoming.length !== (['start', 'audio'].includes(step.kind) ? 0 : 1) ||
      outgoing.some((edge) => edge.sourceHandle)) throw new WorkflowValidationError('graph');
    step = outgoing.length ? document.steps.find((node) => node.id === outgoing[0].target) : undefined;
  }
  if (steps.length !== document.steps.length || steps.at(-1)?.kind !== 'end')
    throw new WorkflowValidationError('graph');
  // Explicit contracts prevent accidental audio→text coercion or marking human input synthetic.
  let type: 'text' | 'audio' | 'speech' = steps[0].kind === 'audio' ? 'audio' : 'text';
  for (const node of steps.slice(1, -1)) {
    if (node.kind === 'speak' && type === 'text') type = 'speech';
    else if (node.kind === 'convert' && type !== 'text') type = 'speech';
    else if (node.kind === 'transcribe' && type !== 'text') type = 'text';
    else if (node.kind === 'translate' && type === 'text') {
      if (!node.sourceLanguage || !node.language || node.language === 'Auto')
        throw new WorkflowValidationError('language');
    } else if (node.kind !== 'normalize' || type !== 'speech')
      throw new WorkflowValidationError('unsupported');
    if (['speak', 'convert'].includes(node.kind) && !node.voiceId?.trim())
      throw new WorkflowValidationError('voice');
  }
  if (steps.length < 3) throw new WorkflowValidationError('unsupported');
  const scripts = steps[0].kind === 'audio'
    ? (steps[0].media || []).map((file) => ({ name: file.name.replace(/\.[^.]+$/, ''), text: '', sourceId: file.id }))
    : steps[0].scripts?.length ? steps[0].scripts : steps[0].text
      .split(/^\s*---\s*$/m).map((text, index) => ({ name: `${index + 1}`, text: text.trim() }));
  if (steps[0].kind === 'audio') {
    if (!scripts.length || scripts.length > 50) throw new WorkflowValidationError('media');
  } else if (!scripts.length || scripts.length > 50 || scripts.some((script) => !script.text.trim() || script.text.length > 20_000))
    throw new WorkflowValidationError('scripts');
  // Layout, names, and selection never invalidate generated audio; executable settings do.
  const signature = JSON.stringify({ engine,
    steps: steps.map(({ id, kind, voiceId, language, speed, targetDb, sourceLanguage, provider }) => ['speak', 'convert'].includes(kind)
      ? { id, kind, voiceId, language: language || 'Auto', speed: speed ?? 1 } : kind === 'normalize' ? { id, kind, targetDb: targetDb ?? -2 } : kind === 'translate' ? { id, kind, sourceLanguage, language, provider: provider || 'argos' }
      : kind === 'transcribe' ? { id, kind } : { id, kind }),
    scripts,
  });
  return { steps, scripts, signature };
}

export function prepareRun(plan: ExecutionPlan, previous?: WorkflowRun | null): WorkflowRun {
  if (previous?.version === 1 && previous.signature === plan.signature && previous.items.length === plan.scripts.length) {
    const restored = structuredClone(previous);
    return { ...restored, items: restored.items.map((item) => ({ ...item, state: item.state === 'done' ? 'done' : 'ready', error: undefined })) };
  }
  return { version: 1, signature: plan.signature, updatedAt: Date.now(), items: plan.scripts.map((script) => ({ ...script, state: 'ready', audio: {}, texts: {} })) };
}

export interface WorkflowOperations {
  loadAudio?(id: string): Promise<Blob>;
  transcribe?(audio: Blob, step: WorkflowStep, signal: AbortSignal): Promise<string>;
  translate?(text: string, step: WorkflowStep, signal: AbortSignal): Promise<string>;
  convert?(audio: Blob, step: WorkflowStep, signal: AbortSignal): Promise<Blob>;
  speak(text: string, step: WorkflowStep, signal: AbortSignal): Promise<Blob>;
  normalize(audio: Blob, step: WorkflowStep, signal: AbortSignal): Promise<Blob>;
}

/** Serial execution avoids competing model loads. Every successful step is a durable checkpoint. */
export async function executeWorkflow(
  plan: ExecutionPlan, run: WorkflowRun, operations: WorkflowOperations,
  signal: AbortSignal, checkpoint: (run: WorkflowRun) => Promise<void>,
): Promise<WorkflowRun> {
  const save = async () => {
    run.updatedAt = Date.now();
    await checkpoint(structuredClone(run));
  };
  await save(); // Storage must work before doing expensive inference.
  for (const item of run.items) {
    if (item.state === 'done') continue;
    try {
      signal.throwIfAborted();
      item.texts ??= {};
      let value: string | Blob = item.text;
      if (item.sourceId) {
        value = item.audio[plan.steps[0].id] || await operations.loadAudio!(item.sourceId);
        item.audio[plan.steps[0].id] = value;
        await save();
      }
      for (const step of plan.steps.slice(1, -1)) {
        signal.throwIfAborted();
        item.stepId = step.id;
        item.state = 'running';
        await save();
        const cached = item.texts[step.id] ?? item.audio[step.id];
        if (cached !== undefined) value = cached;
        else {
          switch (step.kind) {
            case 'speak': value = await operations.speak(value as string, step, signal); break;
            case 'normalize': value = await operations.normalize(value as Blob, step, signal); break;
            case 'transcribe': value = await operations.transcribe!(value as Blob, step, signal); break;
            case 'translate': value = await operations.translate!(value as string, step, signal); break;
            case 'convert': value = await operations.convert!(value as Blob, step, signal); break;
            default: throw new WorkflowValidationError('unsupported');
          }
          if (typeof value === 'string') {
            if (!value.trim()) throw new Error('workflowRun.incomplete');
            item.texts[step.id] = value;
          } else {
            if (!value.size) throw new Error('workflowRun.incomplete');
            item.audio[step.id] = value;
          }
        }
        item.outputStep = step.id;
        await save();
      }
      signal.throwIfAborted();
      item.state = 'done';
      item.stepId = plan.steps.at(-1)!.id;
      await save();
    } catch (error) {
      item.state = signal.aborted ? 'cancelled' : 'failed';
      item.error = signal.aborted ? undefined : error instanceof Error ? error.message : String(error);
      await save();
      break; // Explicit retry; never silently skip a failed clip.
    }
  }
  return run;
}

export function outputName(workflowName: string, itemName: string, index: number, extension: 'wav' | 'txt' = 'wav'): string {
  // Windows disallows control bytes in filenames; stripping them also prevents path surprises.
  // eslint-disable-next-line no-control-regex
  const safe = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70);
  return `${safe(workflowName) || 'workflow'}-${String(index + 1).padStart(2, '0')}-${safe(itemName) || 'audio'}.${extension}`;
}
