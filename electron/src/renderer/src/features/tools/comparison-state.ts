import { Store } from '@tanstack/store';
import { useStore } from '@tanstack/react-store';

type Comparison = { text: string; voices: string[]; searches: string[]; urls: string[] };
const empty = (): Comparison => ({
  text: '',
  voices: ['', ''],
  searches: ['', ''],
  urls: ['', ''],
});
const comparison = new Store<Comparison>(empty());
export const useComparison = () => useStore(comparison);

export function setComparison<K extends keyof Comparison>(
  key: K,
  value: Comparison[K] | ((current: Comparison[K]) => Comparison[K]),
) {
  comparison.setState((current) => {
    const next = typeof value === 'function' ? value(current[key]) : value;
    if (key === 'urls') {
      for (const url of current.urls)
        if (url && !(next as string[]).includes(url)) URL.revokeObjectURL(url);
    }
    return { ...current, [key]: next };
  });
}

export function clearComparison() {
  comparison.state.urls.forEach((url) => {
    if (url) URL.revokeObjectURL(url);
  });
  comparison.setState(empty);
}
