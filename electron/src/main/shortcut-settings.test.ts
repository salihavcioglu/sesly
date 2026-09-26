// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ShortcutSettings, DEFAULT_SHORTCUT } from './shortcut-settings';
function setup(saved?: string) {
  const request = vi.fn(async () => null);
  const persist = vi.fn(async () => {});
  return { request, persist, settings: new ShortcutSettings({ request }, saved, persist) };
}
it('registers once after enabling and unregisters after disabling', async () => {
  const { settings, request } = setup();
  await settings.synchronize(true, 'hold');
  await settings.synchronize(true, 'hold');
  expect(request).toHaveBeenCalledTimes(1);
  expect(settings.getState()).toMatchObject({ accelerator: DEFAULT_SHORTCUT, active: true });
  await settings.synchronize(false, 'toggle');
  expect(request).toHaveBeenLastCalledWith({ method: 'set_shortcut', accelerator: null });
});
it('does not repeat declined portal consent on each background preferences poll', async () => {
  const { settings, request } = setup();
  request.mockRejectedValue(new Error('Declined'));
  await settings.synchronize(true, 'toggle');
  await settings.synchronize(true, 'toggle');
  expect(request).toHaveBeenCalledTimes(1);
  expect(settings.getState().error).toContain('Declined');
});
it('keeps the saved and active binding when a replacement conflicts', async () => {
  const { settings, request, persist } = setup();
  await settings.synchronize(true, 'hold');
  request.mockRejectedValueOnce(new Error('Occupied'));
  await expect(settings.set('Ctrl+Alt+Q')).rejects.toThrow('Occupied');
  expect(persist).not.toHaveBeenCalled();
  expect(settings.getState().accelerator).toBe(DEFAULT_SHORTCUT);
});
it('restores the previous OS registration if saving fails', async () => {
  const { settings, request, persist } = setup();
  await settings.synchronize(true, 'hold');
  persist.mockRejectedValueOnce(new Error('Disk full'));
  await expect(settings.set('Ctrl+Alt+Q')).rejects.toThrow('Disk full');
  expect(request).toHaveBeenLastCalledWith({
    method: 'set_shortcut',
    accelerator: DEFAULT_SHORTCUT,
  });
  expect(settings.getState()).toMatchObject({ accelerator: DEFAULT_SHORTCUT, active: true });
});
it('validates and saves while disabled without leaving an active global binding', async () => {
  const { settings, request, persist } = setup();
  await settings.set('Ctrl+Alt+F24');
  expect(request).toHaveBeenLastCalledWith({ method: 'set_shortcut', accelerator: null });
  expect(persist).toHaveBeenCalledWith('Ctrl+Alt+F24');
  expect(settings.getState()).toEqual({ accelerator: 'Ctrl+Alt+F24', active: false });
});
