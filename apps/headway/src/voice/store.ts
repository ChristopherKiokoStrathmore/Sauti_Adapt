// Reading and writing the voice profile through the AI4A11y toolkit's Librarian.
//
// The profile lives at `fields.voice` in the person's toolkit profile, written with
// librarian.setProfileFields (one write, user-initiated: she pressed Save, so no
// proposal gate). Any app the person grants profile access to can read it through
// the toolkit's normal sharing rules; Headway does not keep a second copy.

import { VOICE_PROFILE_VERSION, type VoiceProfile } from './profile.ts';

export const VOICE_FIELD = 'fields.voice';

/** The part of the toolkit Librarian this module needs (see vendor/ai4a11y-toolkit). */
export interface ProfileLibrarian {
  getProfile(): Promise<{ fields?: Record<string, unknown> } | null>;
  setProfileFields(fields: Record<string, unknown>): Promise<unknown>;
}

export async function saveVoiceProfile(librarian: ProfileLibrarian, profile: VoiceProfile): Promise<void> {
  await librarian.setProfileFields({ [VOICE_FIELD]: profile });
}

export async function loadVoiceProfile(librarian: ProfileLibrarian): Promise<VoiceProfile | null> {
  const profile = await librarian.getProfile();
  const voice = profile?.fields?.voice as VoiceProfile | null | undefined;
  return voice && voice.version === VOICE_PROFILE_VERSION ? voice : null;
}

/** "Forget my voice": removes the measurements from her profile. */
export async function clearVoiceProfile(librarian: ProfileLibrarian): Promise<void> {
  await librarian.setProfileFields({ [VOICE_FIELD]: null });
}
