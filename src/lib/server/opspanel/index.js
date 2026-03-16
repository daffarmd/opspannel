import { env } from '$env/dynamic/private';
import { getConfigSource, loadOpsPanelConfig } from './config.js';
import { openMockLogStream, readMockStatus, runMockAction } from './mock.js';
import { openSshLogStream, readSshStatus, runSshAction } from './ssh.js';
import { opsPanelState } from './state.js';

const STATUS_CACHE_TTL_MS = 5000;
const TRANSITIONAL_STATES = new Set(['starting', 'stopping']);
const ACTION_SETTLE_TIMEOUT_MS = 8000;
const ACTION_SETTLE_INTERVAL_MS = 1000;

class OpsPanelError extends Error {
	constructor(message, meta = {}) {
		super(message);
		this.name = 'OpsPanelError';
		this.statusCode = meta.statusCode || 500;
		this.status = meta.status || null;
	}
}

function executorMode() {
	return env.OPSPANEL_EXECUTOR === 'ssh' ? 'ssh' : 'mock';
}

function getConfig() {
	return loadOpsPanelConfig();
}

function findServiceById(serviceId, config = getConfig()) {
	const service = config.services.find((item) => item.id === serviceId);

	if (!service) {
		throw new OpsPanelError(`Unknown service "${serviceId}".`, {
			statusCode: 404
		});
	}

	const server = config.servers.find((item) => item.id === service.serverId);

	if (!server) {
		throw new OpsPanelError(`Server "${service.serverId}" for service "${serviceId}" was not found.`, {
			statusCode: 500
		});
	}

	return { service, server, config };
}

function serializeServer(server) {
	return {
		id: server.id,
		name: server.name,
		host: server.host,
		port: server.port,
		username: server.username
	};
}

function serializeService(service, server, status = opsPanelState.getStatus(service.id)) {
	return {
		id: service.id,
		name: service.name,
		description: service.description,
		server: serializeServer(server),
		workingDirectory: service.workingDirectory,
		startCommand: service.startCommand,
		stopCommand: service.stopCommand,
		statusCommand: service.statusCommand,
		logCommand: service.logCommand,
		status,
		lastCheckedAt: status.lastCheckedAt
	};
}

export function getExecutorMode() {
	return executorMode();
}

async function readExecutorStatus(service, server) {
	if (executorMode() === 'ssh') {
		return readSshStatus(service, server);
	}

	return readMockStatus(service, opsPanelState);
}

async function resolveServiceStatus(service, server, { force = false, allowDuringLock = false } = {}) {
	const currentStatus = opsPanelState.getStatus(service.id);
	const actionLock = opsPanelState.getActionLock(service.id);
	const shouldBypassCache =
		actionLock && TRANSITIONAL_STATES.has(currentStatus.state) && !allowDuringLock;

	if (!force && !shouldBypassCache && currentStatus.lastCheckedAt) {
		const age = Date.now() - Date.parse(currentStatus.lastCheckedAt);

		if (Number.isFinite(age) && age < STATUS_CACHE_TTL_MS) {
			return currentStatus;
		}
	}

	const nextStatus = await readExecutorStatus(service, server);

	return opsPanelState.setStatus(service.id, {
		state: nextStatus.state,
		note: nextStatus.note ?? null,
		lastCheckedAt: nextStatus.lastCheckedAt ?? new Date().toISOString()
	});
}

async function buildSerializedService(service, server, options = {}) {
	const status = await resolveServiceStatus(service, server, options);
	return serializeService(service, server, status);
}

export async function listServices(options = {}) {
	const config = getConfig();

	return Promise.all(
		config.services.map(async (service) => {
		const server = config.servers.find((item) => item.id === service.serverId);
			return buildSerializedService(service, server, options);
		})
	);
}

export async function getDashboardData(options = {}) {
	const config = getConfig();
	const services = await listServices(options);

	return {
		title: config.title,
		configSource: getConfigSource(),
		executorMode: executorMode(),
		services,
		summary: {
			total: services.length,
			running: services.filter((service) => service.status.state === 'running').length,
			stopped: services.filter((service) => service.status.state === 'stopped').length,
			attention: services.filter((service) =>
				['unknown', 'failed', 'error', 'starting', 'stopping'].includes(service.status.state)
			).length
		}
	};
}

export async function getService(serviceId, options = {}) {
	const { service, server } = findServiceById(serviceId);
	return buildSerializedService(service, server, options);
}

export function getServiceLogs(serviceId) {
	findServiceById(serviceId);
	return opsPanelState.getLogs(serviceId);
}

async function syncServiceStatusAfterAction(service, server, action, result) {
	const status = await resolveServiceStatus(service, server, {
		force: true,
		allowDuringLock: true
	});

	return opsPanelState.setStatus(service.id, {
		state: status.state,
		note: status.note ?? null,
		lastCheckedAt: status.lastCheckedAt,
		lastCommand: action === 'start' ? service.startCommand : service.stopCommand,
		lastResult: result
	});
}

function expectedStateForAction(action) {
	return action === 'start' ? 'running' : 'stopped';
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExpectedServiceState(service, server, expectedState) {
	const deadline = Date.now() + ACTION_SETTLE_TIMEOUT_MS;
	let lastStatus = await resolveServiceStatus(service, server, {
		force: true,
		allowDuringLock: true
	});

	while (lastStatus.state !== expectedState && Date.now() < deadline) {
		await delay(ACTION_SETTLE_INTERVAL_MS);
		lastStatus = await resolveServiceStatus(service, server, {
			force: true,
			allowDuringLock: true
		});
	}

	return lastStatus;
}

export async function runServiceAction(serviceId, action) {
	const { service, server } = findServiceById(serviceId);

	if (!['start', 'stop'].includes(action)) {
		throw new OpsPanelError(`Unsupported action "${action}".`, {
			statusCode: 400
		});
	}

	if (!opsPanelState.lockAction(service.id, action)) {
		const activeLock = opsPanelState.getActionLock(service.id);

		throw new OpsPanelError(
			`${service.name} already has a ${activeLock?.action || 'pending'} action in progress.`,
			{
				statusCode: 409,
				status: opsPanelState.getStatus(service.id)
			}
		);
	}

	const transitionState = action === 'start' ? 'starting' : 'stopping';
	const command = action === 'start' ? service.startCommand : service.stopCommand;

	opsPanelState.setStatus(service.id, {
		state: transitionState,
		lastCommand: command,
		lastResult: null,
		note: 'Action in progress.'
	});

	try {
		const actionResult =
			executorMode() === 'ssh'
				? await runSshAction(service, server, opsPanelState, action)
				: await runMockAction(service, action, opsPanelState);
		const status = await syncServiceStatusAfterAction(service, server, action, 'success');

		return {
			ok: true,
			message: actionResult.message,
			status
		};
	} catch (error) {
		let status = await syncServiceStatusAfterAction(service, server, action, 'failed');
		const expectedState = expectedStateForAction(action);

		if (error.kind === 'command-timeout' && status.state !== expectedState) {
			const settledStatus = await waitForExpectedServiceState(service, server, expectedState);

			status = opsPanelState.setStatus(service.id, {
				...settledStatus,
				lastCommand: command,
				lastResult: settledStatus.state === expectedState ? 'success' : 'failed'
			});
		}

		if (status.state === expectedState) {
			status = opsPanelState.setStatus(service.id, {
				...status,
				lastCommand: command,
				lastResult: 'success'
			});

			opsPanelState.appendLog(
				service.id,
				`[ssh] ${service.name} reached ${status.state} after a delayed ${action} command on ${server.name}.`,
				{ source: 'ssh' }
			);

			return {
				ok: true,
				message: `${service.name} reached ${status.state} after a delayed ${action} command.`,
				status
			};
		}

		if (executorMode() === 'ssh' && error.kind === 'command-timeout') {
			opsPanelState.appendLog(
				service.id,
				`[ssh] ${service.name} ${action} command did not reach ${expectedState}; latest status is ${status.state}.`,
				{ source: 'ssh' }
			);
		}

		throw new OpsPanelError(error.message, {
			statusCode: error.statusCode || 500,
			status
		});
	} finally {
		opsPanelState.unlockAction(service.id);
	}
}

export async function runBulkAction(serviceIds, action) {
	const uniqueIds = [...new Set(serviceIds)];
	const results = await Promise.allSettled(uniqueIds.map((serviceId) => runServiceAction(serviceId, action)));

	return uniqueIds.map((serviceId, index) => {
		const outcome = results[index];

		if (outcome.status === 'fulfilled') {
			return {
				serviceId,
				ok: true,
				message: outcome.value.message,
				status: outcome.value.status
			};
		}

		return {
			serviceId,
			ok: false,
			message: outcome.reason.message,
			status: outcome.reason.status || null
		};
	});
}

export async function openServiceLogStream(serviceId, hooks, signal) {
	const { service, server } = findServiceById(serviceId);

	if (executorMode() === 'ssh') {
		return openSshLogStream(service, server, opsPanelState, hooks, signal);
	}

	return openMockLogStream(service, opsPanelState, hooks);
}
