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
			label: 'Not Ready',
			shortLabel: 'Not ready',
			cardClass: 'border-[#ebe1d5] bg-[#f5efe7] text-[#6b5a4b]',
			buttonClass: 'border-[#ebe1d5] bg-[#f5efe7] text-[#6b5a4b]'
		},
		interested_later: {
			label: 'Interested Later',
			shortLabel: 'Later',
			cardClass: 'border-[#e5c58a] bg-[#fbf1dc] text-[#8a6519]',
			buttonClass: 'border-[#e5c58a] bg-[#fbf1dc] text-[#8a6519]'
		},
		ready_now: {
			label: 'Ready Now',
			shortLabel: 'Ready now',
			cardClass: 'animate-pulse border-[#8b3a4a] bg-[#8b3a4a] text-[#fffdfb] ring-2 ring-[#8b3a4a]',
			buttonClass: 'border-[#8b3a4a] bg-[#8b3a4a] text-[#fffdfb]'
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

	let hydrateVersion = 0;
	let unsubscribeRealtime: (() => void) | null = null;

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

		return () => {
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
			message = 'Tape status saved.';
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
			message = 'Availability saved.';
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
				message = 'Lock screen alerts are disabled on this device.';
			} catch (error) {
				errorMessage = messageFromError(error);
			}
			return;
		}

		const result = await subscribeToPush(session.user.id);

		if (result.ok) {
			pushSubscribed = true;
			message = 'Lock screen alerts are enabled on this device.';
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
			return 'No time set';
		}

		return new Intl.DateTimeFormat(undefined, {
			weekday: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function formatLastUpdated(value: string | undefined) {
		if (!value) {
			return 'Waiting for first update';
		}

		return new Intl.DateTimeFormat(undefined, {
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
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
		<header class="flex items-center justify-between gap-4">
			<div>
				<p class="font-display text-3xl font-medium italic leading-none text-[#2a1e18]">Je t'aime</p>
				<p class="mt-2 text-[0.65rem] font-bold uppercase tracking-[0.28em] text-[#7a6b5e]">
					Shared status
				</p>
			</div>

			{#if profile}
				<div class="flex items-center gap-2">
					<div class="rounded-lg border border-[#ebe1d5] bg-[#fffdfb] px-3 py-2 text-right shadow-sm">
						<p class="text-sm font-semibold text-[#2a1e18]">{profile.display_name}</p>
						<p class="text-xs capitalize text-[#7a6b5e]">{profile.role}</p>
					</div>
					<button
						type="button"
						class="rounded-lg border border-[#ebe1d5] bg-[#fffdfb] px-3 py-2 text-sm font-semibold text-[#7a6b5e] shadow-sm"
						onclick={signOut}
					>
						Sign out
					</button>
				</div>
			{/if}
		</header>

		{#if errorMessage}
			<p class="rounded-lg border border-[#e8b4b4] bg-[#f8e5e5] px-4 py-3 text-sm font-medium text-[#8b3a3a]">
				{errorMessage}
			</p>
		{/if}

		{#if message}
			<p class="rounded-lg border border-[#c5d4b8] bg-[#eef2e8] px-4 py-3 text-sm font-medium text-[#4a6b3a]">
				{message}
			</p>
		{/if}

		{#if !isSupabaseConfigured}
			<section class="rounded-lg border border-[#ebe1d5] bg-[#fffdfb] p-5 shadow-sm">
				<h2 class="text-lg font-bold">Supabase env needed</h2>
				<p class="mt-2 text-sm text-[#7a6b5e]">Copy .env.example to .env and fill in your project URL and anon key.</p>
			</section>
		{:else if loading}
			<section class="rounded-lg border border-[#ebe1d5] bg-[#fffdfb] p-5 text-sm font-semibold text-[#7a6b5e] shadow-sm">
				Loading secure status...
			</section>
		{:else if !session}
			<section class="rounded-lg border border-[#ebe1d5] bg-[#fffdfb] p-5 shadow-sm">
				<form class="grid gap-4" onsubmit={signInWithPassword}>
					<label class="grid gap-2 text-sm font-semibold text-[#7a6b5e]">
						Email
						<input
							bind:value={email}
							autocomplete="email"
							class="h-12 rounded-lg border border-[#ebe1d5] bg-[#fffdfb] px-3 text-base text-[#2a1e18] outline-none ring-[#8b3a4a] transition focus:ring-2"
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
							class="h-12 rounded-lg border border-[#ebe1d5] bg-[#fffdfb] px-3 text-base text-[#2a1e18] outline-none ring-[#8b3a4a] transition focus:ring-2"
							required
							type="password"
						/>
					</label>

					<button
						type="submit"
						class="h-12 rounded-lg bg-[#8b3a4a] px-4 text-base font-bold text-[#fffdfb] shadow-sm"
						disabled={authBusy}
					>
						Sign in
					</button>
				</form>
			</section>
		{:else if !profile}
			<section class="rounded-lg border border-[#e5c58a] bg-[#fbf1dc] p-5 shadow-sm">
				<h2 class="text-lg font-bold text-[#8a6519]">Profile not assigned</h2>
				<p class="mt-2 text-sm text-[#8a6519]">Run the seed block in supabase/schema.sql for this signed-in email.</p>
			</section>
		{:else if status}
			<div class="flex items-center justify-between gap-3 text-xs font-semibold text-[#a89b8c]">
				<span>{realtimeMessage}</span>
				<span>Updated {formatLastUpdated(status.last_updated)}</span>
			</div>

			{#if profile.role === 'husband'}
				<section class={`rounded-lg border p-6 shadow-sm sm:p-8 ${wifeStatus.cardClass}`}>
					<p class="text-[0.65rem] font-bold uppercase tracking-[0.28em] opacity-70">Wife is</p>
					<p class="font-display mt-4 text-6xl font-medium leading-[0.9] tracking-tight sm:text-8xl">
						{wifeStatus.label}
					</p>
				</section>

				<section class="grid gap-4 rounded-lg border border-[#ebe1d5] bg-[#fffdfb] p-5 shadow-sm sm:p-6">
					<div class="flex items-center justify-between gap-4">
						<div>
							<h2 class="text-xl font-bold text-[#2a1e18]">Tape Status</h2>
							<p class="text-sm text-[#7a6b5e]">Estimated off: {formatDateTime(status.tape_estimated_off)}</p>
						</div>
					</div>

					<button
						type="button"
						class={`font-display min-h-24 rounded-lg px-5 text-4xl font-medium text-[#fffdfb] shadow-sm transition active:scale-[0.99] ${
							status.husband_is_taped ? 'bg-[#4a7a3a]' : 'bg-[#2a1e18]'
						}`}
						disabled={saving}
						onclick={toggleTaped}
					>
						{status.husband_is_taped ? 'Taped' : 'Not Taped'}
					</button>

					<label class="grid gap-2 text-sm font-semibold text-[#7a6b5e]">
						Estimated off-time
						<input
							bind:value={offTimeLocal}
							class="h-12 rounded-lg border border-[#ebe1d5] bg-[#fffdfb] px-3 text-base text-[#2a1e18] outline-none ring-[#8b3a4a] transition focus:ring-2"
							disabled={!status.husband_is_taped || saving}
							type="datetime-local"
						/>
					</label>

					<button
						type="button"
						class="h-12 rounded-lg border border-[#ebe1d5] bg-[#f5efe7] px-4 text-base font-bold text-[#2a1e18] shadow-sm"
						disabled={!status.husband_is_taped || saving}
						onclick={() => updateHusbandStatus(status?.husband_is_taped ?? false)}
					>
						Save off-time
					</button>
				</section>
			{:else}
				<section class="rounded-lg border border-[#ebe1d5] bg-[#fffdfb] p-6 shadow-sm sm:p-8">
					<p class="text-[0.65rem] font-bold uppercase tracking-[0.28em] text-[#a89b8c]">Husband is</p>
					<p class={`font-display mt-4 text-6xl font-medium leading-[0.9] tracking-tight sm:text-8xl ${status.husband_is_taped ? 'text-[#4a7a3a]' : 'text-[#2a1e18]'}`}>
						{status.husband_is_taped ? 'Taped' : 'Not Taped'}
					</p>
					<div class="mt-6 rounded-lg border border-[#ebe1d5] bg-[#faf6f0] p-4">
						<p class="text-sm font-semibold text-[#7a6b5e]">Estimated off-time</p>
						<p class="mt-1 text-2xl font-black text-[#2a1e18]">{formatDateTime(status.tape_estimated_off)}</p>
					</div>
				</section>

				<section class="grid gap-3">
					{#each wifeStatusOptions as option (option.value)}
						<button
							type="button"
							class={`min-h-20 rounded-lg border px-5 text-left text-2xl font-black shadow-sm transition active:scale-[0.99] ${
								status.wife_status === option.value ? option.buttonClass : 'border-[#ebe1d5] bg-[#fffdfb] text-[#2a1e18]'
							}`}
							disabled={saving}
							onclick={() => updateWifeStatus(option.value)}
						>
							{option.shortLabel}
						</button>
					{/each}
				</section>
			{/if}

			<button
				type="button"
				class="h-11 rounded-lg border border-[#ebe1d5] bg-[#fffdfb] px-4 text-sm font-bold text-[#7a6b5e] shadow-sm"
				disabled={!pushConfigured || pushSubscribed === null}
				onclick={togglePush}
			>
				{#if !pushConfigured}
					Alerts unavailable
				{:else if pushSubscribed === null}
					Checking alerts…
				{:else if pushSubscribed}
					Alerts on — tap to disable
				{:else}
					Enable alerts
				{/if}
			</button>
		{/if}
	</div>
</main>
