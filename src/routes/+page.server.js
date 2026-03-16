import { getDashboardData } from '$lib/server/opspanel';

export async function load({ locals }) {
	return {
		...(await getDashboardData()),
		user: locals.user
	};
}
