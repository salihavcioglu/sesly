import { resolveConfig } from 'electron-vite';
import { createServer } from 'vite';
const resolved = await resolveConfig({}, 'serve');
if (!resolved.config?.renderer) throw new Error('Renderer config missing');
const server = await createServer({ ...resolved.config.renderer, configFile: false });
await server.listen();
server.printUrls();
