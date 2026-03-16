import { error } from '@sveltejs/kit';
import { getService, getServiceLogs, openServiceLogStream } from '$lib/server/opspanel';

function formatEvent(name, payload) {
	return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET({ params, request }) {
	let service;

	try {
		service = await getService(params.serviceId);
	} catch (caught) {
		throw error(caught.statusCode || 404, caught.message || 'Service not found.');
	}

	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream({
			async start(controller) {
				let closed = false;
				let cleanup = () => {};
				let heartbeat = null;

				const safeClose = () => {
					if (closed) {
						return;
					}

					closed = true;
					clearInterval(heartbeat);
					cleanup();

					try {
						controller.close();
					} catch {
						// Ignore double-close during aborted requests.
					}
				};

				const send = (name, payload) => {
					if (closed) {
						return;
					}

					controller.enqueue(encoder.encode(formatEvent(name, payload)));
				};

				send('snapshot', {
					entries: getServiceLogs(service.id)
				});
				send('ready', {
					serviceId: service.id,
					status: service.status.state
				});

				heartbeat = setInterval(() => {
					if (!closed) {
						controller.enqueue(encoder.encode(': ping\n\n'));
					}
				}, 15000);

				request.signal.addEventListener('abort', safeClose, { once: true });

				try {
					cleanup =
						(await openServiceLogStream(
							service.id,
							{
								onLine(entry) {
									send('line', entry);
								},
								onEnd() {
									if (!request.signal.aborted) {
										send('end', { message: 'Log stream closed.' });
									}
									safeClose();
								}
							},
							request.signal
						)) || (() => {});
				} catch (caught) {
					send('error', { message: caught.message });
					safeClose();
				}
			}
		}),
		{
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive'
			}
		}
	);
}
