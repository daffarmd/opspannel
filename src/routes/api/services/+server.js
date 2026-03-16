import { json } from '@sveltejs/kit';
import { getDashboardData } from '$lib/server/opspanel';

export async function GET() {
	return json(await getDashboardData());
}
