import { getBridge } from '@/components/bridge';

export async function saveLocalFile(blob: Blob, suggestedName: string) {
  const bridge = getBridge();
  if (bridge) {
    return bridge.files.saveData({
      data: new Uint8Array(await blob.arrayBuffer()),
      suggestedName,
    });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { canceled: false };
}
