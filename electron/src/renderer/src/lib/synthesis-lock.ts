let owner: symbol | null = null;

/** Share the single interactive synthesis slot without sharing editor state. */
export function acquireSynthesis(): (() => void) | null {
  if (owner) return null;
  const token = Symbol();
  owner = token;
  return () => {
    if (owner === token) owner = null;
  };
}
