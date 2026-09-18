<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '@supabase/supabase-js';
	import {
		getCurrentPushSubscription,
		registerServiceWorker,
		subscribeToPush,
		unsubscribeFromPush
	} from '$lib/push';
	import { isSupabaseConfigured, supabase } from '$lib/supabase';
	import {
		getProfile,
		getSharedStatus,
		setHusbandTapeStatus,
		setWifeStatus as saveWifeStatus,
		subscribeToSharedStatus
	} from '$lib/status';
	import type { Profile, SharedStatus, WifeStatus } from '$lib/types';

	const wifeStatuses = {
		not_ready: {
			label: 'Not tonight',
			shortLabel: 'Not tonight',
			cardClass: 'border-[#ebe1d5] bg-[#f5efe7] text-[#6b5a4b]',
			buttonClass: 'border-[#ebe1d5] bg-[#f5efe7] text-[#6b5a4b]'
		},
		interested_later: {
			label: 'Maybe later',
			shortLabel: 'Maybe later',
			cardClass: 'border-[#e5c58a] bg-[#fbf1dc] text-[#8a6519]',
			buttonClass: 'border-[#e5c58a] bg-[#fbf1dc] text-[#8a6519]'
		},
		ready_now: {
			label: 'Ready now',
			shortLabel: "I'm ready",
			cardClass:
				'animate-breathe border-[#7a2f3e] bg-gradient-to-br from-[#9b4354] to-[#6b2a38] text-[#fffdfb]',
			buttonClass: 'border-[#8b3a4a] bg-gradient-to-br from-[#9b4354] to-[#6b2a38] text-[#fffdfb]'
		}
	} satisfies Record<
		WifeStatus,
		{ buttonClass: string; cardClass: string; label: string; shortLabel: string }
	>;

	const wifeStatusOptions = [
		{ value: 'not_ready', ...wifeStatuses.not_ready },
		{ value: 'interested_later', ...wifeStatuses.interested_later },
		{ value: 'ready_now', ...wifeStatuses.ready_now }
	] satisfies Array<{ value: WifeStatus } & (typeof wifeStatuses)[WifeStatus]>;

	let authBusy = $state(false);
	let email = $state('');
	let errorMessage = $state('');
	let loading = $state(true);
	let message = $state('');
	let offTimeLocal = $state('');
	let password = $state('');
	let profile = $state<Profile | null>(null);
	let pushSubscribed = $state<boolean | null>(null);
	let realtimeMessage = $state('Realtime connecting');
	let saving = $state(false);
	let session = $state<Session | null>(null);
	let status = $state<SharedStatus | null>(null);
	let now = $state(Date.now());

	let hydrateVersion = 0;
	let unsubscribeRealtime: (() => void) | null = null;

	const greeting = $derived.by(() => {
		const hour = new Date().getHours();
		if (hour >= 5 && hour < 12) return 'Good morning';
		if (hour >= 12 && hour < 17) return 'Good afternoon';
		if (hour >= 17 && hour < 22) return 'Good evening';
		return 'Hello';
	});

	const wifeStatus = $derived(status ? wifeStatuses[status.wife_status] : wifeStatuses.not_ready);
	const pushConfigured = $derived(Boolean(import.meta.env.VITE_PUBLIC_VAPID_KEY));

	onMount(() => {
		if (!isSupabaseConfigured) {
			loading = false;
			errorMessage = 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart the dev server.';
			return;
		}

		void registerServiceWorker().then(async () => {
			pushSubscribed = Boolean(await getCurrentPushSubscription());
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, nextSession) => {
			session = nextSession;
			void hydrateAuthenticatedUser(nextSession);
		});

		const ticker = setInterval(() => {
			now = Date.now();
		}, 30000);

		return () => {
			clearInterval(ticker);
			subscription.unsubscribe();
			unsubscribeRealtime?.();
		};
	});

	async function hydrateAuthenticatedUser(nextSession: Session | null) {
		const currentHydration = (hydrateVersion += 1);

		loading = true;
		errorMessage = '';
		message = '';
		profile = null;
		status = null;
		unsubscribeRealtime?.();
		unsubscribeRealtime = null;

		if (!nextSession) {
			loading = false;
			realtimeMessage = 'Signed out';
			return;
		}

		try {
			const nextProfile = await getProfile(nextSession.user.id);
			const nextStatus = await getSharedStatus();

			if (currentHydration !== hydrateVersion) {
				return;
			}

			profile = nextProfile;
			status = nextStatus;
			syncOffTimeDraft(nextStatus);
			realtimeMessage = 'Realtime connected';

			unsubscribeRealtime = subscribeToSharedStatus(
				(nextStatus) => {
					if (currentHydration !== hydrateVersion) {
						return;
					}

					status = nextStatus;
					syncOffTimeDraft(nextStatus);
					realtimeMessage = 'Realtime connected';
				},
				(nextError) => {
					realtimeMessage = nextError;
				}
			);
		} catch (error) {
			if (currentHydration !== hydrateVersion) {
				return;
			}

			errorMessage = messageFromError(error);
		} finally {
			if (currentHydration === hydrateVersion) {
				loading = false;
			}
		}
	}

	async function signInWithPassword(event: SubmitEvent) {
		event.preventDefault();
		authBusy = true;
		errorMessage = '';
		message = '';

		try {
			const { error } = await supabase.auth.signInWithPassword({ email, password });

			if (error) {
				throw error;
			}

			password = '';
		} catch (error) {
			errorMessage = messageFromError(error);
		} finally {
			authBusy = false;
		}
	}

	async function signOut() {
		if (!confirm("Sign out of Je t'aime?")) {
			return;
		}

		await supabase.auth.signOut();
	}

	async function toggleTaped() {
		if (!status) {
			return;
		}

		await updateHusbandStatus(!status.husband_is_taped);
	}

	async function updateHusbandStatus(nextTapedValue = status?.husband_is_taped ?? false) {
		saving = true;
		errorMessage = '';
		message = '';

		try {
			await setHusbandTapeStatus(nextTapedValue, localInputToIso(offTimeLocal));
			message = 'Saved.';
		} catch (error) {
			errorMessage = messageFromError(error);
		} finally {
			saving = false;
		}
	}

	async function updateWifeStatus(nextStatus: WifeStatus) {
		saving = true;
		errorMessage = '';
		message = '';

		try {
			await saveWifeStatus(nextStatus);
			message = 'Saved.';
		} catch (error) {
			errorMessage = messageFromError(error);
		} finally {
			saving = false;
		}
	}

	async function togglePush() {
		if (!session) {
			return;
		}

		errorMessage = '';
		message = '';

		if (pushSubscribed) {
			try {
				await unsubscribeFromPush();
				pushSubscribed = false;
				message = 'Alerts off.';
			} catch (error) {
				errorMessage = messageFromError(error);
			}
			return;
		}

		const result = await subscribeToPush(session.user.id);

		if (result.ok) {
			pushSubscribed = true;
			message = 'Alerts on.';
		} else {
			errorMessage = result.reason;
		}
	}

	function syncOffTimeDraft(nextStatus: SharedStatus | null) {
		offTimeLocal = isoToLocalInput(nextStatus?.tape_estimated_off ?? null);
	}

	function isoToLocalInput(value: string | null) {
		if (!value) {
			return '';
		}

		const date = new Date(value);
		const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return localDate.toISOString().slice(0, 16);
	}

	function localInputToIso(value: string) {
		if (!value) {
			return null;
		}

		return new Date(value).toISOString();
	}

	function formatDateTime(value: string | null) {
		if (!value) {
			return 'Not set';
		}

		return new Intl.DateTimeFormat(undefined, {
			weekday: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function formatLastUpdated(value: string | undefined, currentTime: number) {
		if (!value) {
			return 'Waiting for first update';
		}

		const then = new Date(value).getTime();
		const diffSeconds = Math.floor((currentTime - then) / 1000);

		if (diffSeconds < 45) return 'Just now';

		const diffMinutes = Math.floor(diffSeconds / 60);
		if (diffMinutes < 60) return `${diffMinutes} min ago`;

		const diffHours = Math.floor(diffMinutes / 60);
		if (diffHours < 24) return `${diffHours}h ago`;

		const diffDays = Math.floor(diffHours / 24);
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return `${diffDays} days ago`;

		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric'
		}).format(new Date(value));
	}

	function messageFromError(error: unknown) {
		return error instanceof Error ? error.message : 'Something went wrong.';
	}
</script>

<svelte:head>
	<title>Je t'aime</title>
</svelte:head>

<main class="min-h-screen bg-[#faf6f0] text-[#2a1e18]">
	<div class="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
		<header class="px-1">
			<p class="font-display text-3xl font-medium leading-tight text-[#2a1e18]">
				{greeting}{profile ? `, ${profile.display_name}` : ''}
			</p>
			<p class="mt-3 text-[0.6rem] font-bold uppercase tracking-[0.32em] text-[#a89b8c]">
				Je t'aime
			</p>
		</header>

		{#if errorMessage}
			<p class="rounded-2xl border border-[#e8b4b4] bg-[#f8e5e5] px-4 py-3 text-sm font-medium text-[#8b3a3a]">
				{errorMessage}
			</p>
		{/if}

		{#if message}
			<p class="rounded-2xl border border-[#c5d4b8] bg-[#eef2e8] px-4 py-3 text-sm font-medium text-[#4a6b3a]">
				{message}
			</p>
		{/if}

		{#if !isSupabaseConfigured}
			<section class="rounded-2xl border border-[#ebe1d5] bg-[#fffdfb] p-5 shadow-soft">
				<h2 class="text-lg font-bold">Supabase env needed</h2>
				<p class="mt-2 text-sm text-[#7a6b5e]">Copy .env.example to .env and fill in your project URL and anon key.</p>
			</section>
		{:else if loading}
			<section class="rounded-2xl border border-[#ebe1d5] bg-[#fffdfb] p-5 text-sm font-semibold text-[#7a6b5e] shadow-soft">
				Loading secure status...
			</section>
		{:else if !session}
			<section class="rounded-2xl border border-[#ebe1d5] bg-[#fffdfb] p-5 shadow-soft">
				<form class="grid gap-4" onsubmit={signInWithPassword}>
					<label class="grid gap-2 text-sm font-semibold text-[#7a6b5e]">
						Email
						<input
							bind:value={email}
							autocomplete="email"
							class="h-12 rounded-2xl border border-[#ebe1d5] bg-[#fffdfb] px-3 text-base text-[#2a1e18] outline-none ring-[#8b3a4a] transition focus:ring-2"
							placeholder="you@example.com"
							required
							type="email"
						/>
					</label>

					<label class="grid gap-2 text-sm font-semibold text-[#7a6b5e]">
						Password
						<input
							bind:value={password}
							autocomplete="current-password"
							class="h-12 rounded-2xl border border-[#ebe1d5] bg-[#fffdfb] px-3 text-base text-[#2a1e18] outline-none ring-[#8b3a4a] transition focus:ring-2"
							required
							type="password"
						/>
					</label>

					<button
						type="submit"
						class="h-12 rounded-2xl bg-[#8b3a4a] px-4 text-base font-bold text-[#fffdfb] shadow-soft"
						disabled={authBusy}
					>
						Sign in
					</button>
				</form>
			</section>
		{:else if !profile}
			<section class="rounded-2xl border border-[#e5c58a] bg-[#fbf1dc] p-5 shadow-soft">
				<h2 class="text-lg font-bold text-[#8a6519]">Profile not assigned</h2>
				<p class="mt-2 text-sm text-[#8a6519]">Run the seed block in supabase/schema.sql for this signed-in email.</p>
			</section>
		{:else if status}
			<div class="px-1 text-xs font-semibold text-[#a89b8c]">
				<span>Updated {formatLastUpdated(status.last_updated, now)}</span>
			</div>

			{#if profile.role === 'husband'}
				<section
					class={`animate-fade-up overflow-hidden rounded-3xl border shadow-soft-lg ${wifeStatus.cardClass}`}
					style="animation-delay: 0ms"
				>
					<div class="p-6 sm:p-8">
						<p class="text-[0.65rem] font-bold uppercase tracking-[0.28em] opacity-70">She says</p>
						{#key wifeStatus.label}
							<p
								class="font-display animate-soft-fade-in mt-4 text-6xl font-medium leading-[0.9] tracking-tight sm:text-8xl"
							>
								{wifeStatus.label}
							</p>
						{/key}
					</div>

					<div class="border-t border-black/10 bg-[#fffdfb] p-6 text-[#2a1e18] sm:p-8">
						<div class="flex items-center justify-between gap-4">
							<div>
								<h2 class="text-xl font-bold text-[#2a1e18]">Tape Status</h2>
								{#if status.husband_is_taped}
									<p class="mt-1 flex items-center gap-1.5 text-sm text-[#7a6b5e]">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<circle cx="12" cy="12" r="10" />
											<polyline points="12 6 12 12 16 14" />
										</svg>
										<span>Off {formatDateTime(status.tape_estimated_off)}</span>
									</p>
								{/if}
							</div>
						</div>

						<button
							type="button"
							class={`font-display mt-4 min-h-20 w-full rounded-2xl px-5 text-3xl font-medium text-[#fffdfb] shadow-soft transition active:scale-[0.97] ${
								status.husband_is_taped ? 'bg-[#4a7a3a]' : 'bg-[#2a1e18]'
							}`}
							disabled={saving}
							onclick={toggleTaped}
						>
							{status.husband_is_taped ? 'Taped' : 'Not taped'}
						</button>

						{#if status.husband_is_taped}
							<div class="mt-5 grid gap-3">
								<label class="grid gap-2 text-sm font-semibold text-[#7a6b5e]">
									Estimated off-time
									<input
										bind:value={offTimeLocal}
										class="h-12 rounded-2xl border border-[#ebe1d5] bg-[#fffdfb] px-3 text-base text-[#2a1e18] outline-none ring-[#8b3a4a] transition focus:ring-2"
										disabled={saving}
										type="datetime-local"
									/>
								</label>

								<button
									type="button"
									class="h-12 rounded-2xl border border-[#ebe1d5] bg-[#f5efe7] px-4 text-base font-bold text-[#2a1e18] shadow-soft"
									disabled={saving}
									onclick={() => updateHusbandStatus(status?.husband_is_taped ?? false)}
								>
									Save off-time
								</button>
							</div>
						{/if}
					</div>
				</section>
			{:else}
				<section
					class="animate-fade-up overflow-hidden rounded-3xl border border-[#ebe1d5] bg-[#fffdfb] shadow-soft-lg"
					style="animation-delay: 0ms"
				>
					<div class="p-6 sm:p-8">
						<p class="text-[0.65rem] font-bold uppercase tracking-[0.28em] text-[#a89b8c]">He's</p>
						{#key status.husband_is_taped}
							<p
								class={`font-display animate-soft-fade-in mt-4 text-6xl font-medium leading-[0.9] tracking-tight sm:text-8xl ${status.husband_is_taped ? 'text-[#4a7a3a]' : 'text-[#2a1e18]'}`}
							>
								{status.husband_is_taped ? 'Taped' : 'Not Taped'}
							</p>
						{/key}
						{#if status.husband_is_taped}
							<div class="mt-6 rounded-2xl border border-[#ebe1d5] bg-[#faf6f0] p-4">
								<p class="flex items-center gap-1.5 text-sm font-semibold text-[#7a6b5e]">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="12" cy="12" r="10" />
										<polyline points="12 6 12 12 16 14" />
									</svg>
									<span>Estimated off-time</span>
								</p>
								<p class="mt-1 text-2xl font-black text-[#2a1e18]">{formatDateTime(status.tape_estimated_off)}</p>
							</div>
						{/if}
					</div>

					<div class="border-t border-[#ebe1d5] bg-[#fffdfb] p-6 sm:p-8">
						<p class="text-[0.65rem] font-bold uppercase tracking-[0.28em] text-[#a89b8c]">You say</p>
						<div class="mt-4 grid gap-3">
							{#each wifeStatusOptions as option (option.value)}
								<button
									type="button"
									class={`min-h-20 rounded-2xl border px-5 text-left text-2xl font-black shadow-soft transition active:scale-[0.97] ${
										status.wife_status === option.value ? option.buttonClass : 'border-[#ebe1d5] bg-[#fffdfb] text-[#2a1e18]'
									}`}
									disabled={saving}
									onclick={() => updateWifeStatus(option.value)}
								>
									{option.shortLabel}
								</button>
							{/each}
						</div>
					</div>
				</section>
			{/if}

			<footer class="mt-2 flex items-center justify-between gap-4 border-t border-[#ebe1d5] px-1 pt-6">
				<button
					type="button"
					class="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-[#a89b8c] transition hover:text-[#7a6b5e] disabled:opacity-50"
					disabled={!pushConfigured || pushSubscribed === null}
					onclick={togglePush}
				>
					{#if !pushConfigured}
						Alerts unavailable
					{:else if pushSubscribed === null}
						Checking…
					{:else if pushSubscribed}
						Alerts on
					{:else}
						Enable alerts
					{/if}
				</button>
				<button
					type="button"
					class="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-[#a89b8c] transition hover:text-[#7a6b5e]"
					onclick={signOut}
				>
					Sign out
				</button>
			</footer>
		{/if}
	</div>
</main>