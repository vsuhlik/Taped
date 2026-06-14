<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.json" />
	<link rel="apple-touch-icon" href="/icons/icon.svg" />
	<meta name="application-name" content="Taped" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Taped" />
	<meta name="theme-color" content="#111827" />
</svelte:head>
{@render children()}
