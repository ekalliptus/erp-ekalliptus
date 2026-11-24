import type { MessagePayload, Messaging } from 'firebase/messaging';
import { erpApi } from './api.js';
import { firebaseWebConfig } from './firebase-config.js';

let messaging: Messaging | null = null;
let messagingModulePromise: Promise<typeof import('firebase/messaging')> | null = null;

function loadMessagingModule() {
  if (!messagingModulePromise) {
    messagingModulePromise = import('firebase/messaging');
  }
  return messagingModulePromise;
}

export function notificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'Notification' in window
  );
}

export async function ensureFirebaseMessaging(): Promise<Messaging | null> {
  if (!notificationSupported()) return null;
  const [{ getApps, initializeApp }, { getMessaging, isSupported }] = await Promise.all([
    import('firebase/app'),
    loadMessagingModule(),
  ]);
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
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const m = await ensureFirebaseMessaging();
  if (!m) return 'unavailable';

  const vapidKey = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;
  if (!vapidKey) {
    console.warn('[notifikasi] VITE_FCM_VAPID_KEY belum diisi: push web belum aktif, bell in-app tetap berjalan.');
    return 'granted';
  }

  const [{ getToken }, registration] = await Promise.all([
    loadMessagingModule(),
    navigator.serviceWorker.register('/firebase-messaging-sw.js'),
  ]);
  const token = await getToken(m, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return 'granted';
  await erpApi.notifications.registerToken({ token, platform: 'web' });
  return 'granted';
}

export function onForegroundMessage(cb: (payload: MessagePayload) => void): () => void {
  if (!notificationSupported() || Notification.permission !== 'granted') {
    return () => {};
  }
  let disposed = false;
  let unsub: (() => void) | null = null;
  void Promise.all([ensureFirebaseMessaging(), loadMessagingModule()]).then(([m, mod]) => {
    if (disposed || !m) return;
    unsub = mod.onMessage(m, cb);
  });
  return () => {
    disposed = true;
    unsub?.();
  };
}
