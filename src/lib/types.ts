export type AppRole = 'husband' | 'wife';

export type WifeStatus = 'not_ready' | 'interested_later' | 'ready_now';

export type Profile = {
	id: string;
	role: AppRole;
	display_name: string;
	created_at: string;
	updated_at: string;
};

export type SharedStatus = {
	id: number;
	husband_is_taped: boolean;
	tape_estimated_off: string | null;
	wife_status: WifeStatus;
	last_updated: string;
};
