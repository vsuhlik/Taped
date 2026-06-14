# Taped

A private SvelteKit, Tailwind CSS, TypeScript, and Supabase PWA for two-person realtime status coordination.

## File placement

- `src/routes/+page.svelte` - authenticated dual-view UI for Husband and Wife.
- `src/lib/supabase.ts` - Supabase client configured from Vite env vars.
- `src/lib/status.ts` - shared status fetch, update, and realtime subscription helpers.
- `src/lib/push.ts` - service worker registration and Push API subscription helper.
- `src/lib/types.ts` - app role, wife status, profile, and shared status types.
- `static/manifest.json` - PWA manifest with `"display": "standalone"`.
- `static/sw.js` - service worker shell for push events and notification clicks.
- `static/icons/icon.svg` - app icon referenced by the manifest and service worker.
- `supabase/schema.sql` - executable schema, RLS policies, realtime publication, and seed template.
- `.env.example` - required client-side environment variables.

## Supabase setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Create or invite the two Auth users.
4. Run the seed block at the bottom of `supabase/schema.sql` after replacing `husband@example.com` and `wife@example.com`.
5. Copy `.env.example` to `.env` and fill in:

```sh
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

`VITE_PUBLIC_VAPID_KEY` is optional until you wire up a server-side Web Push sender or Supabase Edge Function. Keep the matching VAPID private key server-side only.

## Run locally

```sh
npm install
npm run dev
```

Then open the local URL Vite prints.

## PWA and iOS notes

The app includes `static/manifest.json`, iOS web app meta tags in `src/routes/+layout.svelte`, and `static/sw.js`. For iOS lock screen push notifications, test from an installed Home Screen web app over HTTPS and request notification permission from a user gesture.

The service worker can receive push payloads shaped like:

```json
{
	"title": "Taped",
	"body": "Status changed.",
	"url": "/"
}
```

## Realtime flow

`src/lib/status.ts` subscribes to Supabase Realtime on `public.shared_status`:

```ts
supabase
	.channel('shared-status-updates')
	.on(
		'postgres_changes',
		{ event: '*', schema: 'public', table: 'shared_status', filter: 'id=eq.1' },
		(payload) => onStatus(payload.new as SharedStatus)
	)
	.subscribe();
```

Both signed-in devices receive the update immediately after either person updates their allowed status fields.
