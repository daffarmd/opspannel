import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySession } from '$lib/server/auth';

function isPublicPath(pathname) {
	return pathname === '/login' || pathname.startsWith('/_app') || pathname === '/robots.txt';
}

export async function handle({ event, resolve }) {
	const session = verifySession(event.cookies.get(SESSION_COOKIE));
	event.locals.user = session;

	if (!session && !isPublicPath(event.url.pathname)) {
		if (event.url.pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ message: 'Unauthorized' }), {
				status: 401,
				headers: {
					'Content-Type': 'application/json'
				}
			});
		}

		throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	}

	if (session && event.url.pathname === '/login') {
		throw redirect(303, '/');
	}

	return resolve(event);
}
