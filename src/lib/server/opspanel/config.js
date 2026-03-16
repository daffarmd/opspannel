import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';

const fallbackConfig = {
	title: 'OpsPanel',
	servers: [
		{
			id: 'dev-01',
			name: 'dev-01',
			host: '127.0.0.1',
			port: 22,
			username: 'developer',
			privateKeyPath: 'C:/Users/your-user/.ssh/id_rsa'
		}
	],
	services: [
		{
			id: 'api-server',
			name: 'API Server',
			serverId: 'dev-01',
			description: 'REST API for the development environment',
			workingDirectory: '/var/www/project-api',
			startCommand: 'npm run dev',
			stopCommand: 'pkill -f "npm run dev"',
			statusCommand: 'pgrep -f "npm run dev" >/dev/null && echo running || echo stopped',
			logCommand: 'tail -n 100 -f logs/app.log'
		},
		{
			id: 'worker',
			name: 'Worker',
			serverId: 'dev-01',
			description: 'Queue processor for async jobs',
			workingDirectory: '/var/www/project-worker',
			startCommand: 'npm run worker',
			stopCommand: 'pkill -f "npm run worker"',
			statusCommand: 'pgrep -f "npm run worker" >/dev/null && echo running || echo stopped',
			logCommand: 'tail -n 100 -f logs/worker.log'
		},
		{
			id: 'scheduler',
			name: 'Scheduler',
			serverId: 'dev-01',
			description: 'Cron-like scheduler for recurring tasks',
			workingDirectory: '/var/www/project-scheduler',
			startCommand: 'npm run scheduler',
			stopCommand: 'pkill -f "npm run scheduler"',
			statusCommand: 'pgrep -f "npm run scheduler" >/dev/null && echo running || echo stopped',
			logCommand: 'tail -n 100 -f logs/scheduler.log'
		}
	]
};

function slugify(value) {
	return String(value ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function resolveConfigPath() {
	const explicitPath = env.OPSPANEL_CONFIG_PATH;
	const candidates = explicitPath
		? [path.resolve(process.cwd(), explicitPath)]
		: [
				path.resolve(process.cwd(), 'opspanel.config.json'),
				path.resolve(process.cwd(), 'opspannel.config.json')
			];

	return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function normalizeServer(server, index) {
	const id = server.id || slugify(server.name) || `server-${index + 1}`;

	return {
		id,
		name: server.name || id,
		host: server.host || '127.0.0.1',
		port: Number(server.port || 22),
		username: server.username || 'root',
		privateKey: server.privateKey || null,
		privateKeyEnv: server.privateKeyEnv || null,
		privateKeyPath: server.privateKeyPath || null
	};
}

function normalizeService(service, index, serverIds) {
	const id = service.id || slugify(service.name) || `service-${index + 1}`;
	const serverId = service.serverId || service.server || serverIds[0];
	const statusCommand = String(service.statusCommand || '').trim();

	if (!serverId) {
		throw new Error(`Service "${service.name || id}" does not reference a server.`);
	}

	if (!serverIds.includes(serverId)) {
		throw new Error(`Service "${service.name || id}" references unknown server "${serverId}".`);
	}

	if (!statusCommand) {
		throw new Error(`Service "${service.name || id}" is missing required field "statusCommand".`);
	}

	return {
		id,
		name: service.name || id,
		description: service.description || 'No description provided.',
		serverId,
		workingDirectory: service.workingDirectory || '.',
		startCommand: service.startCommand || 'echo "No start command configured"',
		stopCommand: service.stopCommand || 'echo "No stop command configured"',
		statusCommand,
		logCommand: service.logCommand || '',
		remoteLogFile: service.remoteLogFile || null
	};
}

function normalizeConfig(config) {
	const servers = (config.servers || []).map(normalizeServer);
	const serverIds = servers.map((server) => server.id);
	const services = (config.services || []).map((service, index) =>
		normalizeService(service, index, serverIds)
	);

	return {
		title: config.title || fallbackConfig.title,
		servers,
		services
	};
}

export function loadOpsPanelConfig() {
	const configPath = resolveConfigPath();

	if (!configPath) {
		return normalizeConfig(fallbackConfig);
	}

	try {
		const raw = fs.readFileSync(configPath, 'utf8');
		return normalizeConfig(JSON.parse(raw));
	} catch (error) {
		throw new Error(`Failed to read OpsPanel config at ${configPath}: ${error.message}`);
	}
}

export function getConfigSource() {
	return resolveConfigPath() || 'built-in sample config';
}
