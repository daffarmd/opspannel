import { fail, redirect } from '@sveltejs/kit';
import { authenticate, setSession } from '$lib/server/auth';

function normalizeNext(pathname) {
	return typeof pathname === 'string' && pathname.startsWith('/') ? pathname : '/';
}

export function load({ url }) {
	return {
		next: normalizeNext(url.searchParams.get('next'))
	};
}

export const actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const username = String(formData.get('username') || '').trim();
		const password = String(formData.get('password') || '');
		const next = normalizeNext(formData.get('next'));

		if (!authenticate(username, password)) {
			return fail(400, {
				error: 'Invalid username or password.',
				username,
				next
			});
		}

		setSession(cookies, username);
		throw redirect(303, next);
	}
};
