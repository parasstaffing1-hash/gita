/**
 * Network access.
 *
 * The reader path does not use this — it reads SQLite. This is for filling
 * that local copy, for Ask the Gita, and for syncing user data. Anything that
 * calls it must degrade gracefully when the device is offline.
 */
import Constants from 'expo-constants';
import { createApiClient } from '@gita/api-client';

const configured =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

/**
 * On a physical Android device `localhost` is the phone, not the laptop.
 * `10.0.2.2` is the emulator's alias for the host, which is the common case
 * during development.
 */
function defaultBaseUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:8000`;
  return 'http://10.0.2.2:8000';
}

export const API_URL = configured ?? defaultBaseUrl();

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export const api = createApiClient({
  baseUrl: API_URL,
  getAccessToken: () => accessToken,
  timeoutMs: 20_000,
});
