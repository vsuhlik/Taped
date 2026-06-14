import { supabase } from '$lib/supabase';

type PushRegistrationResult =
	| { ok: true; subscription: PushSubscriptionJSON }
	| { ok: false; reason: string };

export async function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) {
		return null;
	}

	return navigator.serviceWorker.register('/sw.js');
}

export async function subscribeToPush(userId: string, publicVapidKey = import.meta.env.VITE_PUBLIC_VAPID_KEY) {
	if (!publicVapidKey) {
		return { ok: false, reason: 'Missing VITE_PUBLIC_VAPID_KEY.' } satisfies PushRegistrationResult;
	}

	if (!('Notification' in window) || !('PushManager' in window)) {
		return { ok: false, reason: 'Push notifications are not supported in this browser.' } satisfies PushRegistrationResult;
	}

	const permission = await Notification.requestPermission();

	if (permission !== 'granted') {
		return { ok: false, reason: 'Notification permission was not granted.' } satisfies PushRegistrationResult;
	}

	const registration = await registerServiceWorker();

	if (!registration) {
		return { ok: false, reason: 'Service workers are not available.' } satisfies PushRegistrationResult;
	}

	const subscription = await registration.pushManager.subscribe({
		applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
		userVisibleOnly: true
	});

	const subscriptionJson = subscription.toJSON();

	await supabase.from('push_subscriptions').upsert(
		{
			user_id: userId,
			endpoint: subscription.endpoint,
			subscription: subscriptionJson
		},
		{ onConflict: 'endpoint' }
	);

	return { ok: true, subscription: subscriptionJson } satisfies PushRegistrationResult;
}

function urlBase64ToUint8Array(base64String: string) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let index = 0; index < rawData.length; index += 1) {
		outputArray[index] = rawData.charCodeAt(index);
	}

	return outputArray;
}
