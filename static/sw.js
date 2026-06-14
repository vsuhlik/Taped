self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
	let payload = {
		title: 'Taped',
		body: 'There is a status update.',
		url: '/'
	};

	if (event.data) {
		try {
			payload = { ...payload, ...event.data.json() };
		} catch {
			payload.body = event.data.text();
		}
	}

	const options = {
		body: payload.body,
		badge: '/icons/icon.svg',
		data: {
			url: payload.url || '/'
		},
		icon: '/icons/icon.svg',
		renotify: true,
		tag: 'shared-status'
	};

	event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const url = new URL(event.notification.data?.url || '/', self.location.origin).href;

	event.waitUntil(
		self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
			for (const client of clients) {
				if (client.url === url && 'focus' in client) {
					return client.focus();
				}
			}

			return self.clients.openWindow(url);
		})
	);
});
