const keyPair = await crypto.subtle.generateKey(
	{
		name: 'ECDSA',
		namedCurve: 'P-256'
	},
	true,
	['sign', 'verify']
);

const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

console.log(`VITE_PUBLIC_VAPID_KEY=${base64UrlEncode(publicKey)}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey.d}`);

function base64UrlEncode(value) {
	return Buffer.from(value)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}
