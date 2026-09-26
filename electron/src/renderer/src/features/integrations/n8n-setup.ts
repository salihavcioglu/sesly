import template from './n8n-workflow.json';
import { backendEndpoint } from './mcp-setup';

/** A manual workflow: exporting it never starts generation or enables networking. */
export function n8nSetup(slug: string, baseUrl: string) {
  if (slug !== 'n8n') return null;
  const url = backendEndpoint(baseUrl, '/v1/audio/speech');
  if (!url) return null;
  const workflow = {
    id: crypto.randomUUID().replaceAll('-', '').slice(0, 20),
    ...structuredClone(template),
  };
  const request = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.httpRequest')!;
  request.parameters.url = url;
  return {
    file: 'sesly-n8n.json',
    docs: 'https://github.com/salihavcioglu/sesly/blob/main/docs/integrations/n8n.md',
    text: JSON.stringify(workflow, null, 2),
  };
}
