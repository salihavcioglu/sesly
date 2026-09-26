import { editLongform, longformSession, type Mode } from '@/features/longform/longform-session';
/** Add a gallery voice without replacing the user's script or existing cast. */
export function placeLongformVoice(profile: { id: string; name: string }, target: Mode): void {
  if (longformSession.state.active) throw new Error('Production is active');
  const draft = longformSession.state.drafts[target];
  if (target === 'audiobook') {
    editLongform(target, { voice: profile.id });
    return;
  }
  if (draft.cast.some((member) => member.profileId === profile.id)) return;
  editLongform(target, {
    cast: [...draft.cast, { id: crypto.randomUUID(), name: profile.name, profileId: profile.id }],
  });
}
