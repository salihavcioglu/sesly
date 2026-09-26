import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/client';
import { updateProfileImage } from '@/lib/api/profiles';
import type { Profile } from '@/lib/api/types';
import { queryKeys } from '@/lib/query';
import { PortraitSearch } from './portrait-search';

export function ProfileImageEditor({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const save = async (file: File) => {
    if (busy) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('profileIdentity.image_limit'));
      return;
    }
    setBusy(true);
    try {
      const updated = await updateProfileImage(profile.id, file);
      queryClient.setQueryData<Profile[]>(queryKeys.profiles, (old) =>
        old?.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      toast.error(t('clone.save_failed', { message: describeError(error) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-3">
        <ProfileAvatar
          name={profile.name}
          imageUrl={profile.image_url}
          className="size-12 text-base"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{profile.name}</p>
          <Label className="mt-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {busy ? t('preferences.loading') : t('profileIdentity.upload_image')}
            <input
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void save(file);
              }}
            />
          </Label>
        </div>
      </div>
      <PortraitSearch name={profile.name} disabled={busy} onSelect={(file) => void save(file)} />
    </div>
  );
}
