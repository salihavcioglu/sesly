import { apiJson } from './client';
import type { EnginesResponse, SystemInfo } from './types';

export async function getEngines(): Promise<EnginesResponse> {
  return apiJson<EnginesResponse>('/engines');
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return apiJson<SystemInfo>('/system/info');
}
