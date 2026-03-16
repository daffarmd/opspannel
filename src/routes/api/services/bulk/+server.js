import { error, json } from '@sveltejs/kit';
import { runBulkAction } from '$lib/server/opspanel';

export async function POST({ request }) {
	const body = await request.json();
	const action = body?.action;
	const serviceIds = Array.isArray(body?.serviceIds) ? body.serviceIds : [];

	if (!['start', 'stop'].includes(action)) {
		throw error(400, 'Action must be "start" or "stop".');
	}

	if (serviceIds.length === 0) {
		throw error(400, 'Provide at least one service ID.');
	}

	const results = await runBulkAction(serviceIds, action);

	return json({
		action,
		results
	});
}
