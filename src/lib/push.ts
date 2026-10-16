// 通知（Web プッシュ）の登録まわり
import { api } from './api';

export type PushState =
  | 'unsupported' // このブラウザでは使えない
  | 'ios_needs_home' // iPhone：ホーム画面に追加してから開く必要がある
  | 'denied' // 通知がブロックされている
  | 'off' // まだ受け取っていない
  | 'on'; // 受け取っている

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** 画面を開いたときにサービスワーカーを登録しておく（通知を受け取るのに必要） */
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'ios_needs_home' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyToBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function subscriptionParts(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' };
}

/** 許可を求めて、このスマホを通知の宛先に登録する。登録した購読を返す */
async function subscribe(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? '通知がブロックされました。スマホの設定から許可してください。' : '通知は許可されませんでした。');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as BufferSource });
}

export async function enableStaffPush(token: string, deviceId: string, staffId: string | null, publicKey: string) {
  const sub = await subscribe(publicKey);
  const p = subscriptionParts(sub);
  await api.pushSubscribeStaff(token, deviceId, staffId, p.endpoint, p.p256dh, p.auth);
}

export async function enableAdminPush(session: string, deviceId: string, publicKey: string) {
  const sub = await subscribe(publicKey);
  const p = subscriptionParts(sub);
  await api.pushSubscribeAdmin(session, deviceId, p.endpoint, p.p256dh, p.auth);
}

/** 受け取っている通知の宛先を、今の名前に合わせて登録し直す（名前の変更のあとなど） */
export async function syncStaffPush(token: string, deviceId: string, staffId: string | null) {
  if (!supported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  const p = subscriptionParts(sub);
  await api.pushSubscribeStaff(token, deviceId, staffId, p.endpoint, p.p256dh, p.auth);
}

export async function disablePush(token: string) {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(token, sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/** 溜まっている通知を送ってもらう（操作のあとに呼ぶ。失敗しても気にしない） */
export function kickPushDispatch(): void {
  try {
    void fetch('/api/push-dispatch', { method: 'POST', keepalive: true }).catch(() => undefined);
  } catch {
    // 送れなくても、毎朝の定期実行で送られる
  }
}

function toBase64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 管理者用：通知の鍵（公開鍵・秘密鍵・合言葉）をこのブラウザで作る */
export async function generatePushKeys(): Promise<{ publicKey: string; privateKey: string; secret: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = toBase64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const secret = toBase64url(crypto.getRandomValues(new Uint8Array(24)));
  return { publicKey, privateKey: jwk.d ?? '', secret };
}
