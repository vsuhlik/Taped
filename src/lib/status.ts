import { supabase } from '$lib/supabase';
import type { Profile, SharedStatus, WifeStatus } from '$lib/types';

export const SHARED_STATUS_ID = 1;

export async function getProfile(userId: string) {
	const { data, error } = await supabase
		.from('profiles')
		.select('id, role, display_name, created_at, updated_at')
		.eq('id', userId)
		.single<Profile>();

	if (error) {
		throw error;
	}

	return data;
}

export async function getSharedStatus() {
	const { data, error } = await supabase
		.from('shared_status')
		.select('id, husband_is_taped, tape_estimated_off, wife_status, last_updated')
		.eq('id', SHARED_STATUS_ID)
		.single<SharedStatus>();

	if (error) {
		throw error;
	}

	return data;
}

export async function setHusbandTapeStatus(husbandIsTaped: boolean, tapeEstimatedOff: string | null) {
	const { error } = await supabase
		.from('shared_status')
		.update({
			husband_is_taped: husbandIsTaped,
			tape_estimated_off: husbandIsTaped ? tapeEstimatedOff : null
		})
		.eq('id', SHARED_STATUS_ID);

	if (error) {
		throw error;
	}
}

export async function setWifeStatus(wifeStatus: WifeStatus) {
	const { error } = await supabase
		.from('shared_status')
		.update({ wife_status: wifeStatus })
		.eq('id', SHARED_STATUS_ID);

	if (error) {
		throw error;
	}
}

export function subscribeToSharedStatus(onStatus: (status: SharedStatus) => void, onError: (message: string) => void) {
	const channelName = `shared-status-updates-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	const channel = supabase
		.channel(channelName)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'shared_status',
				filter: `id=eq.${SHARED_STATUS_ID}`
			},
			(payload) => {
				if (payload.new) {
					onStatus(payload.new as SharedStatus);
				}
			}
		)
		.subscribe((state, error) => {
			if (error) {
				onError(error.message);
			}

			if (state === 'CHANNEL_ERROR') {
				onError('Realtime channel could not stay connected.');
			}
		});

	return () => {
		void supabase.removeChannel(channel);
	};
}
