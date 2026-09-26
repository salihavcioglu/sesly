const ACTION_REQUEST = /^ACTION_REQUEST\s*:/i;

export function isAppOperationRequest(report: string): boolean {
  return ACTION_REQUEST.test(report.trimStart());
}

export function canRunRepairRequest(report: string, workspaceAvailable: boolean): boolean {
  return workspaceAvailable || isAppOperationRequest(report);
}
