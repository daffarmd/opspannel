import { error } from '@sveltejs/kit';
import { getExecutorMode, getService, getServiceLogs } from '$lib/server/opspanel';

export async function load({ params, locals }) {
	try {
		return {
			service: await getService(params.serviceId),
			initialLogs: getServiceLogs(params.serviceId),
			executorMode: getExecutorMode(),
			user: locals.user
		};
	} catch (caught) {
		throw error(caught.statusCode || 404, caught.message || 'Service not found.');
	}
}
