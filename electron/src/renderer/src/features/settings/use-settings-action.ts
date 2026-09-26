import { useRef, useState } from 'react';
export function useSettingsAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const run = async (work: () => Promise<void>, notify = true) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      await work();
      setSaved(notify);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { busy, error, saved, run, reset: () => setSaved(false) };
}
