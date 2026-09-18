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

	const { error } = await supabase.from('push_subscriptions').upsert(
		{
			user_id: userId,
			endpoint: subscription.endpoint,
			subscription: subscriptionJson
		},
		{ onConflict: 'endpoint' }
	);

	if (error) {
		return { ok: false, reason: error.message } satisfies PushRegistrationResult;
	}

	return { ok: true, subscription: subscriptionJson } satisfies PushRegistrationResult;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		return null;
	}

	const registration = await navigator.serviceWorker.getRegistration();

	if (!registration) {
		return null;
	}

	return registration.pushManager.getSubscription();
}

export async function unsubscribeFromPush() {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		return;
	}

	const registration = await navigator.serviceWorker.getRegistration();

	if (!registration) {
		return;
	}

	const subscription = await registration.pushManager.getSubscription();

	if (!subscription) {
		return;
	}

	const endpoint = subscription.endpoint;

	await subscription.unsubscribe();
	await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
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
