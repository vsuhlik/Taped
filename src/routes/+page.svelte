<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import type { Session } from '@supabase/supabase-js';
	import { registerServiceWorker, subscribeToPush } from '$lib/push';
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
			cardClass: 'border-slate-200 bg-slate-100 text-slate-700',
			buttonClass: 'border-slate-300 bg-slate-100 text-slate-800'
		},
		interested_later: {
			label: 'Interested Later',
			shortLabel: 'Later',
			cardClass: 'border-yellow-300 bg-yellow-100 text-yellow-900',
			buttonClass: 'border-yellow-300 bg-yellow-100 text-yellow-950'
		},
		ready_now: {
			label: 'Ready Now',
			shortLabel: 'Ready now',
			cardClass: 'animate-pulse border-green-300 bg-green-100 text-green-950 ring-2 ring-green-300',
			buttonClass: 'border-green-400 bg-green-600 text-white'
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
	let profile = $state<Profile | null>(null);
	let realtimeMessage = $state('Realtime connecting');
	let saving = $state(false);
	let session = $state<Session | null>(null);
	let status = $state<SharedStatus | null>(null);

	let unsubscribeRealtime: (() => void) | null = null;

	const wifeStatus = $derived(status ? wifeStatuses[status.wife_status] : wifeStatuses.not_ready);

	onMount(() => {
		if (!isSupabaseConfigured) {
			loading = false;
			errorMessage = 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart the dev server.';
			return;
		}

		void registerServiceWorker();
		void initializeSession();

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, nextSession) => {
			session = nextSession;
			void hydrateAuthenticatedUser();
		});

		return () => {
			subscription.unsubscribe();
			unsubscribeRealtime?.();
		};
	});

	async function initializeSession() {
		const { data, error } = await supabase.auth.getSession();

		if (error) {
			errorMessage = error.message;
			loading = false;
			return;
		}

		session = data.session;
		await hydrateAuthenticatedUser();
	}

	async function hydrateAuthenticatedUser() {
		loading = true;
		errorMessage = '';
		message = '';
		profile = null;
		status = null;
		unsubscribeRealtime?.();
		unsubscribeRealtime = null;

		if (!session) {
			loading = false;
			realtimeMessage = 'Signed out';
			return;
		}

		try {
			profile = await getProfile(session.user.id);
			status = await getSharedStatus();
			syncOffTimeDraft(status);
			realtimeMessage = 'Realtime connected';

			unsubscribeRealtime = subscribeToSharedStatus(
				(nextStatus) => {
					status = nextStatus;
					syncOffTimeDraft(nextStatus);
					realtimeMessage = 'Realtime connected';
				},
				(nextError) => {
					realtimeMessage = nextError;
				}
			);
		} catch (error) {
			errorMessage = messageFromError(error);
		} finally {
			loading = false;
		}
	}

	async function sendMagicLink(event: SubmitEvent) {
		event.preventDefault();
		authBusy = true;
		errorMessage = '';
		message = '';

		try {
			const { error } = await supabase.auth.signInWithOtp({
				email,
				options: {
					emailRedirectTo: browser ? window.location.origin : undefined
				}
			});

			if (error) {
				throw error;
			}

			message = 'Check your email for the sign-in link.';
		} catch (error) {
			errorMessage = messageFromError(error);
		} finally {
			authBusy = false;
		}
	}

	async function signOut() {
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

	async function enablePush() {
		if (!session) {
			return;
		}

		errorMessage = '';
		message = '';
		const result = await subscribeToPush(session.user.id);

		if (result.ok) {
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
	<title>Taped</title>
</svelte:head>

<main class="min-h-screen bg-slate-50 text-slate-950">
	<div class="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
		<header class="flex items-center justify-between gap-4">
			<div>
				<p class="text-sm font-semibold text-slate-500">Taped</p>
				<h1 class="text-2xl font-bold text-slate-950">Shared Status</h1>
			</div>

			{#if profile}
				<div class="flex items-center gap-2">
					<div class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-right shadow-sm">
						<p class="text-sm font-semibold text-slate-950">{profile.display_name}</p>
						<p class="text-xs capitalize text-slate-500">{profile.role}</p>
					</div>
					<button
						type="button"
						class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
						onclick={signOut}
					>
						Sign out
					</button>
				</div>
			{/if}
		</header>

		{#if errorMessage}
			<p class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
				{errorMessage}
			</p>
		{/if}

		{#if message}
			<p class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
				{message}
			</p>
		{/if}

		{#if !isSupabaseConfigured}
			<section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
				<h2 class="text-lg font-bold">Supabase env needed</h2>
				<p class="mt-2 text-sm text-slate-600">Copy .env.example to .env and fill in your project URL and anon key.</p>
			</section>
		{:else if loading}
			<section class="rounded-lg border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-600 shadow-sm">
				Loading secure status...
			</section>
		{:else if !session}
			<section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
				<form class="grid gap-4" onsubmit={sendMagicLink}>
					<label class="grid gap-2 text-sm font-semibold text-slate-700">
						Email
						<input
							bind:value={email}
							class="h-12 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none ring-slate-900 transition focus:ring-2"
							placeholder="you@example.com"
							required
							type="email"
						/>
					</label>

					<button
						type="submit"
						class="h-12 rounded-lg bg-slate-950 px-4 text-base font-bold text-white shadow-sm"
						disabled={authBusy}
					>
						Send sign-in link
					</button>
				</form>
			</section>
		{:else if !profile}
			<section class="rounded-lg border border-yellow-200 bg-yellow-50 p-5 shadow-sm">
				<h2 class="text-lg font-bold text-yellow-950">Profile not assigned</h2>
				<p class="mt-2 text-sm text-yellow-900">Run the seed block in supabase/schema.sql for this signed-in email.</p>
			</section>
		{:else if status}
			<div class="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
				<span>{realtimeMessage}</span>
				<span>Updated {formatLastUpdated(status.last_updated)}</span>
			</div>

			{#if profile.role === 'husband'}
				<section class={`rounded-lg border p-6 shadow-sm sm:p-8 ${wifeStatus.cardClass}`}>
					<p class="text-base font-bold opacity-75">Wife is</p>
					<p class="mt-3 text-5xl font-black leading-none sm:text-7xl">{wifeStatus.label}</p>
				</section>

				<section class="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
					<div class="flex items-center justify-between gap-4">
						<div>
							<h2 class="text-xl font-bold text-slate-950">Tape Status</h2>
							<p class="text-sm text-slate-500">Estimated off: {formatDateTime(status.tape_estimated_off)}</p>
						</div>
					</div>

					<button
						type="button"
						class={`min-h-24 rounded-lg px-5 text-3xl font-black text-white shadow-sm transition active:scale-[0.99] ${
							status.husband_is_taped ? 'bg-green-600' : 'bg-slate-950'
						}`}
						disabled={saving}
						onclick={toggleTaped}
					>
						{status.husband_is_taped ? 'Taped' : 'Not Taped'}
					</button>

					<label class="grid gap-2 text-sm font-semibold text-slate-700">
						Estimated off-time
						<input
							bind:value={offTimeLocal}
							class="h-12 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none ring-slate-900 transition focus:ring-2"
							disabled={!status.husband_is_taped || saving}
							type="datetime-local"
						/>
					</label>

					<button
						type="button"
						class="h-12 rounded-lg border border-slate-300 bg-slate-100 px-4 text-base font-bold text-slate-950 shadow-sm"
						disabled={!status.husband_is_taped || saving}
						onclick={() => updateHusbandStatus(status?.husband_is_taped ?? false)}
					>
						Save off-time
					</button>
				</section>
			{:else}
				<section class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
					<p class="text-base font-bold text-slate-500">Husband is</p>
					<p class={`mt-3 text-5xl font-black leading-none sm:text-7xl ${status.husband_is_taped ? 'text-green-700' : 'text-slate-900'}`}>
						{status.husband_is_taped ? 'Taped' : 'Not Taped'}
					</p>
					<div class="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p class="text-sm font-semibold text-slate-500">Estimated off-time</p>
						<p class="mt-1 text-2xl font-black text-slate-950">{formatDateTime(status.tape_estimated_off)}</p>
					</div>
				</section>

				<section class="grid gap-3">
					{#each wifeStatusOptions as option (option.value)}
						<button
							type="button"
							class={`min-h-20 rounded-lg border px-5 text-left text-2xl font-black shadow-sm transition active:scale-[0.99] ${
								status.wife_status === option.value ? option.buttonClass : 'border-slate-200 bg-white text-slate-950'
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
				class="h-11 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm"
				onclick={enablePush}
			>
				Enable alerts
			</button>
		{/if}
	</div>
</main>
