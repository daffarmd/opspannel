import { error, json } from '@sveltejs/kit';
import { getService, runServiceAction } from '$lib/server/opspanel';

export async function POST({ params, request }) {
	const body = await request.json();
	const action = body?.action;

	if (!['start', 'stop'].includes(action)) {
		throw error(400, 'Action must be "start" or "stop".');
	}

	try {
		const result = await runServiceAction(params.serviceId, action);
		return json({
			service: await getService(params.serviceId),
			result
		});
	} catch (caught) {
		throw error(caught.statusCode || 500, caught.message);
	}
}
