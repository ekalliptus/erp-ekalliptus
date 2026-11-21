import { getApps, initializeApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging';
import { erpApi } from './api.js';
import { firebaseWebConfig } from './firebase-config.js';

let messaging: Messaging | null = null;

export function notificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

export async function ensureFirebaseMessaging(): Promise<Messaging | null> {
  if (!notificationSupported()) return null;
  if (!(await isSupported().catch(() => false))) return null;
  if (!messaging) {
    const app = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseWebConfig);
    messaging = getMessaging(app);
  }
  return messaging;
}

export type WebNotificationResult = 'granted' | 'denied' | 'unavailable';

export async function enableWebNotifications(): Promise<WebNotificationResult> {
  if (!notificationSupported()) return 'unavailable';
  if (!(await isSupported().catch(() => false)) || !('Notification' in window)) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'default' ? 'denied' : 'denied';
  const messaging = await ensureFirebaseMessaging();
  if (!messaging) return 'unavailable';

  const vapidKey = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;
  if (!vapidKey) {
    console.warn('[notifikasi] VITE_FCM_VAPID_KEY belum diisi: push web belum aktif, bell in-app tetap berjalan.');
    return 'granted';
  }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return 'granted';
  await erpApi.notifications.registerToken({ token, platform: 'web' });
  return 'granted';
}

export function onForegroundMessage(cb: (payload: MessagePayload) => void): () => void {
  let unsub: (() => void) | null = null;
  void ensureFirebaseMessaging().then((m) => {
    if (m) unsub = onMessage(m, cb);
  });
  return () => {
    unsub?.();
  };
}
