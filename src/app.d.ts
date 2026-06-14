// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface ImportMetaEnv {
		readonly VITE_PUBLIC_VAPID_KEY: string;
		readonly VITE_SUPABASE_ANON_KEY: string;
		readonly VITE_SUPABASE_URL: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
