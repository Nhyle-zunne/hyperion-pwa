import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isSignedFormat, verifyDetailed } from '../lib/signedLicenseVerifier';
import { getDeviceToken } from '../lib/deviceId';

export type ProTierCode = 'ALL' | 'OIC' | 'GOC' | 'EW' | 'DM' | 'EM';

export interface OfflineLicenseInfo {
  tier: string;
  duration: string;
  activationEpoch: number;
  issueEpoch: number;
  expiryEpoch: number;
  isTampered: boolean;
  highWaterMarkEpoch: number;
}

export type UnlockResult =
  | { success: true; message: string; tier: string }
  | { success: false; message: string };

interface LicenseState {
  // Unlock flags
  isOicNwUnlocked: boolean;
  isGmdssUnlocked: boolean;
  isEngineEwUnlocked: boolean;
  isDeckMgtUnlocked: boolean;
  isEngineMgtUnlocked: boolean;
  isAllAccessUnlocked: boolean;

  offlineLicense: OfflineLicenseInfo | null;
  lastVerifiedEpoch: number;
  highWaterMarkEpoch: number;
  clockTampered: boolean;

  // Actions
  activateKey: (rawKey: string) => Promise<UnlockResult>;
  checkLicenseStatus: () => void;
  isTrackUnlocked: (track: string) => boolean;
  getRemainingLabel: () => string;
  clearLicense: () => void;
}

function computeEffectiveNow(info: OfflineLicenseInfo | null, highWater: number): number {
  const now = Date.now();
  if (!info) return Math.max(now, highWater);
  return Math.max(now, info.activationEpoch, info.issueEpoch, highWater);
}

function isExpired(info: OfflineLicenseInfo | null, highWater: number): boolean {
  if (!info || info.expiryEpoch <= 0) return true;
  return computeEffectiveNow(info, highWater) >= info.expiryEpoch;
}

function formatRemaining(info: OfflineLicenseInfo | null, highWater: number): string {
  if (!info) return 'No active license';
  if (info.isTampered) return 'Clock Tampered';
  if (isExpired(info, highWater)) return 'License Expired';

  const remainingMs = Math.max(0, info.expiryEpoch - computeEffectiveNow(info, highWater));
  const totalSecs = Math.floor(remainingMs / 1000);
  const totalMins = Math.floor(totalSecs / 60);
  const totalHours = Math.floor(totalMins / 60);
  const days = Math.floor((totalHours + 23) / 24);
  const mins = totalMins % 60;

  if (days > 1) return `${days} days remaining`;
  if (totalHours > 1) return `${totalHours} hrs, ${mins} mins remaining`;
  if (totalHours === 1) return `1 hr, ${mins} mins remaining`;
  if (mins > 0) return `${mins} mins remaining`;
  return '< 1 min remaining';
}

export const useLicenseStore = create<LicenseState>()(
  persist(
    (set, get) => ({
      isOicNwUnlocked: false,
      isGmdssUnlocked: false,
      isEngineEwUnlocked: false,
      isDeckMgtUnlocked: false,
      isEngineMgtUnlocked: false,
      isAllAccessUnlocked: false,
      offlineLicense: null,
      lastVerifiedEpoch: 0,
      highWaterMarkEpoch: 0,
      clockTampered: false,

      activateKey: async (rawKey: string) => {
        const clean = rawKey.trim().toUpperCase().replace(/\s+/g, '');
        if (!clean) {
          return { success: false, message: 'ERR: Please paste your HYPE2 activation key.' };
        }

        const deviceToken = getDeviceToken();

        if (isSignedFormat(clean)) {
          const result = await verifyDetailed(clean, deviceToken);
          if (!result.ok) {
            const messages: Record<string, string> = {
              format: 'ERR: Key must start with HYPE2-',
              decode: 'ERR: Key could not be decoded (check for missing characters when pasting).',
              signature:
                'ERR: Invalid signature. Key was not signed with the Hyperion key that matches this app, or the key is corrupted.',
              version: 'ERR: Unsupported key version.',
              plan: 'ERR: Invalid plan or duration in key.',
              dates: 'ERR: Key dates are invalid (end must be after issue).',
              device: `ERR: This key is bound to a different device. Generate a new key using this device’s code (${deviceToken}).`,
              error: 'ERR: Could not verify key.'
            };
            return {
              success: false,
              message: messages[result.reason] || 'ERR: INVALID OR UNRECOGNIZED ACTIVATION KEY'
            };
          }
          const signed = result.key;

          const now = Date.now();
          if (now >= signed.expiryEpoch) {
            return { success: false, message: 'ERR: ACTIVATION KEY HAS EXPIRED.' };
          }

          // Simple clock check: if system time is far before issue, treat as tamper
          if (now < signed.issueEpoch - 7 * 86_400_000) {
            set({ clockTampered: true });
            return { success: false, message: 'ERR: CLOCK TAMPERING DETECTED. RESTORE CORRECT SYSTEM TIME.' };
          }

          const info: OfflineLicenseInfo = {
            tier: signed.tier,
            duration: signed.duration,
            activationEpoch: now,
            issueEpoch: signed.issueEpoch,
            expiryEpoch: signed.expiryEpoch,
            isTampered: false,
            highWaterMarkEpoch: now
          };

          const updates: Partial<LicenseState> = {
            offlineLicense: info,
            lastVerifiedEpoch: now,
            highWaterMarkEpoch: Math.max(get().highWaterMarkEpoch, now),
            clockTampered: false
          };

          // Set unlock flags based on tier
          if (signed.tier === 'ALL') {
            updates.isAllAccessUnlocked = true;
            updates.isOicNwUnlocked = true;
            updates.isGmdssUnlocked = true;
            updates.isEngineEwUnlocked = true;
            updates.isDeckMgtUnlocked = true;
            updates.isEngineMgtUnlocked = true;
          } else if (signed.tier === 'OIC') {
            updates.isOicNwUnlocked = true;
          } else if (signed.tier === 'GOC') {
            updates.isGmdssUnlocked = true;
          } else if (signed.tier === 'EW') {
            updates.isEngineEwUnlocked = true;
          } else if (signed.tier === 'DM') {
            updates.isDeckMgtUnlocked = true;
          } else if (signed.tier === 'EM') {
            updates.isEngineMgtUnlocked = true;
          }

          set(updates);

          const messages: Record<string, string> = {
            ALL: 'Hyperion All-Access Unlocked! Offline review access active.',
            OIC: 'OIC-NW Deck Unlocked! Offline review access active.',
            GOC: 'GMDSS GOC Unlocked! Offline review access active.',
            EW: 'OIC-EW Engine Unlocked! Offline review access active.',
            DM: 'Deck Management Unlocked! Offline review access active.',
            EM: 'Engine Management Unlocked! Offline review access active.'
          };

          return {
            success: true,
            message: messages[signed.tier] || 'License Activated!',
            tier: signed.tier
          };
        }

        return { success: false, message: 'ERR: INVALID OR UNRECOGNIZED ACTIVATION KEY' };
      },

      checkLicenseStatus: () => {
        const state = get();
        if (!state.offlineLicense) return;

        const now = Date.now();
        const highWater = Math.max(state.highWaterMarkEpoch, now);

        // Only bump high-water mark if clock moved meaningfully (avoids render loops)
        if (now - state.highWaterMarkEpoch > 5_000) {
          set({ highWaterMarkEpoch: now });
        }

        // Re-evaluate unlocks if expired
        if (isExpired(state.offlineLicense, highWater)) {
          if (
            state.isOicNwUnlocked ||
            state.isGmdssUnlocked ||
            state.isEngineEwUnlocked ||
            state.isDeckMgtUnlocked ||
            state.isEngineMgtUnlocked ||
            state.isAllAccessUnlocked
          ) {
            set({
              isOicNwUnlocked: false,
              isGmdssUnlocked: false,
              isEngineEwUnlocked: false,
              isDeckMgtUnlocked: false,
              isEngineMgtUnlocked: false,
              isAllAccessUnlocked: false
            });
          }
        }
      },

      isTrackUnlocked: (track: string) => {
        const s = get();
        if (s.isAllAccessUnlocked) return true;
        const t = track.toUpperCase();
        // Exact ids first (track ids and plan codes), so e.g. ENGINE_OIC_EW is never read as OIC.
        switch (t) {
          case 'DECK_OIC_NW':
          case 'OIC':
            return s.isOicNwUnlocked;
          case 'GMDSS_GOC':
          case 'GOC':
          case 'GMDSS':
            return s.isGmdssUnlocked;
          case 'ENGINE_OIC_EW':
          case 'EW':
            return s.isEngineEwUnlocked;
          case 'DECK_MGT':
          case 'DM':
            return s.isDeckMgtUnlocked;
          case 'ENGINE_MGT':
          case 'EM':
            return s.isEngineMgtUnlocked;
          default:
            return false;
        }
      },

      getRemainingLabel: () => {
        const s = get();
        return formatRemaining(s.offlineLicense, s.highWaterMarkEpoch);
      },

      clearLicense: () => {
        set({
          isOicNwUnlocked: false,
          isGmdssUnlocked: false,
          isEngineEwUnlocked: false,
          isDeckMgtUnlocked: false,
          isEngineMgtUnlocked: false,
          isAllAccessUnlocked: false,
          offlineLicense: null,
          clockTampered: false
        });
      }
    }),
    {
      name: 'hyperion-license',
      partialize: (state) => ({
        isOicNwUnlocked: state.isOicNwUnlocked,
        isGmdssUnlocked: state.isGmdssUnlocked,
        isEngineEwUnlocked: state.isEngineEwUnlocked,
        isDeckMgtUnlocked: state.isDeckMgtUnlocked,
        isEngineMgtUnlocked: state.isEngineMgtUnlocked,
        isAllAccessUnlocked: state.isAllAccessUnlocked,
        offlineLicense: state.offlineLicense,
        lastVerifiedEpoch: state.lastVerifiedEpoch,
        highWaterMarkEpoch: state.highWaterMarkEpoch,
        clockTampered: state.clockTampered
      })
    }
  )
);
