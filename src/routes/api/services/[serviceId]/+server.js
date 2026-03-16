import { error, json } from '@sveltejs/kit';
import { getService } from '$lib/server/opspanel';

export async function GET({ params }) {
	try {
		return json({
			service: await getService(params.serviceId)
		});
	} catch (caught) {
		throw error(caught.statusCode || 404, caught.message || 'Service not found.');
	}
}
