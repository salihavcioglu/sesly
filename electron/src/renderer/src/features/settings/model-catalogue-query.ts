import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api/client';
import { useBackendStatus } from '@/hooks/use-backend-status';

export interface CatalogueModel {
  repo_id: string;
  label: string;
  role: string;
  families?: string[];
  size_gb: number;
  installed: boolean;
  supported: boolean;
  dictation_id?: string;
  required?: boolean;
  curated?: boolean;
  incomplete?: boolean;
  size_on_disk_bytes?: number;
  note?: string;
  gated?: boolean;
  requires_hf_token?: boolean;
  access_url?: string;
  prerequisite_repo_id?: string;
  prerequisite_access_url?: string;
  failure_topic?: string;
}

export interface ModelCatalogueResponse {
  target?: string;
  models: CatalogueModel[];
  total_installed_bytes?: number;
  disk_free_gb?: number;
}

export function useModelCatalogue() {
  const status = useBackendStatus();
  return useQuery({
    queryKey: ['model-catalogue'],
    queryFn: () => apiJson<ModelCatalogueResponse>('/models'),
    staleTime: 30_000,
    enabled: status.stage === 'ready',
    refetchInterval: (query) =>
      query.state.data?.target && query.state.data.target !== 'local' ? 5_000 : false,
  });
}
