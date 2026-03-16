function sleep(duration) {
	return new Promise((resolve) => setTimeout(resolve, duration));
}

function randomItem(items) {
	return items[Math.floor(Math.random() * items.length)];
}

function timestamp() {
	return new Date().toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

const logTemplates = [
	'health check OK',
	'connected to postgres',
	'queue depth stable',
	'processed inbound event',
	'cache warm complete',
	'heartbeat acknowledged',
	'request latency within threshold'
];

class MockRuntime {
	constructor() {
		this.intervalByService = new Map();
		this.stateByService = new Map();
	}

	getServiceState(serviceId) {
		if (!this.stateByService.has(serviceId)) {
			this.stateByService.set(serviceId, 'stopped');
		}

		return this.stateByService.get(serviceId);
	}

	setServiceState(serviceId, nextState) {
		this.stateByService.set(serviceId, nextState);
	}

	ensureActivity(service, state) {
		if (this.intervalByService.has(service.id)) {
			return;
		}

		const interval = setInterval(() => {
			const currentStatus = state.getStatus(service.id);

			if (currentStatus.state !== 'running') {
				this.stopActivity(service.id);
				return;
			}

			state.appendLog(service.id, `[${timestamp()}] ${service.name}: ${randomItem(logTemplates)}`, {
				source: 'mock'
			});
		}, 1800);

		this.intervalByService.set(service.id, interval);
	}

	stopActivity(serviceId) {
		const interval = this.intervalByService.get(serviceId);

		if (!interval) {
			return;
		}

		clearInterval(interval);
		this.intervalByService.delete(serviceId);
	}
}

const runtimeKey = '__opspanel_mock_runtime__';

function upgradeMockRuntime(candidate) {
	const runtime = candidate instanceof MockRuntime ? candidate : Object(candidate || {});

	Object.setPrototypeOf(runtime, MockRuntime.prototype);

	runtime.intervalByService ??= new Map();
	runtime.stateByService ??= new Map();

	return runtime;
}

const mockRuntime = upgradeMockRuntime(
	globalThis[runtimeKey] || (globalThis[runtimeKey] = new MockRuntime())
);

export async function runMockAction(service, action, state) {
	const currentState = mockRuntime.getServiceState(service.id);

	if (action === 'start') {
		if (currentState === 'running') {
			return {
				message: `${service.name} is already running.`
			};
		}

		state.appendLog(service.id, `[${timestamp()}] Starting ${service.name} with mock executor`, {
			source: 'mock'
		});
		await sleep(500);
		mockRuntime.setServiceState(service.id, 'running');

		mockRuntime.ensureActivity(service, state);

		return {
			message: `Executed mock start command: ${service.startCommand}`
		};
	}

	if (action === 'stop') {
		if (currentState !== 'running') {
			return {
				message: `${service.name} is already stopped.`
			};
		}

		await sleep(350);
		mockRuntime.setServiceState(service.id, 'stopped');
		mockRuntime.stopActivity(service.id);
		state.appendLog(service.id, `[${timestamp()}] Stopped ${service.name}`, { source: 'mock' });

		return {
			message: `Executed mock stop command: ${service.stopCommand}`
		};
	}

	throw new Error(`Unsupported mock action: ${action}`);
}

export async function readMockStatus(service) {
	return {
		state: mockRuntime.getServiceState(service.id),
		note: null,
		lastCheckedAt: new Date().toISOString()
	};
}

export function openMockLogStream(service, state, hooks) {
	if (mockRuntime.getServiceState(service.id) === 'running') {
		mockRuntime.ensureActivity(service, state);
	}

	const unsubscribe = state.subscribe(service.id, (entry) => {
		hooks.onLine?.(entry);
	});

	return () => {
		unsubscribe();
		hooks.onEnd?.();
	};
}
