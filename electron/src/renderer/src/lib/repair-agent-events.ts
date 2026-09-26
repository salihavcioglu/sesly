export const REPAIR_AGENT_OPEN_EVENT = 'sesly:repair-agent-open';
export const DEFAULT_REPAIR_AGENT_KEY = 'sesly.defaultRepairAgent';

export interface RepairAgentRequest {
  report?: string;
  autoFix?: boolean;
}

let pendingRequest: RepairAgentRequest | null = null;

export function takePendingRepairRequest(): RepairAgentRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}

export function openRepairAgent(report?: string, autoFix = false): void {
  pendingRequest = report ? { report, autoFix } : {};
  window.dispatchEvent(
    new CustomEvent(REPAIR_AGENT_OPEN_EVENT, {
      detail: pendingRequest,
    }),
  );
}
