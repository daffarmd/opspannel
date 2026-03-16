import fs from 'node:fs/promises';
import { Client } from 'ssh2';
import { env } from '$env/dynamic/private';

const SSH_CONNECT_TIMEOUT_MS = 8000;
const SSH_START_TIMEOUT_MS = 3000;
const SSH_STOP_TIMEOUT_MS = 20000;
const SSH_STATUS_TIMEOUT_MS = 5000;
const VALID_SERVICE_STATES = new Set(['running', 'stopped', 'failed', 'unknown']);

class RemoteCommandError extends Error {
	constructor(message, meta = {}) {
		super(message);
		this.name = 'RemoteCommandError';
		Object.assign(this, meta);
	}
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sanitizeId(value) {
	return String(value || 'service').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function quoteRemotePath(value) {
	return `"${String(value).replace(/(["\\`])/g, '\\$1')}"`;
}

async function resolvePrivateKey(server) {
	if (server.privateKey) {
		return server.privateKey;
	}

	if (server.privateKeyEnv) {
		const envValue = env[server.privateKeyEnv];

		if (!envValue) {
			throw new Error(`Missing private key env var "${server.privateKeyEnv}" for server ${server.name}.`);
		}

		return envValue;
	}

	if (server.privateKeyPath) {
		return fs.readFile(server.privateKeyPath, 'utf8');
	}

	throw new Error(`No SSH private key configured for server ${server.name}.`);
}

function normalizeRemoteError(message, meta = {}) {
	return new RemoteCommandError(message, meta);
}

async function connect(server, timeoutMs = SSH_CONNECT_TIMEOUT_MS) {
	const privateKey = await resolvePrivateKey(server);

	return new Promise((resolve, reject) => {
		const client = new Client();
		let settled = false;
		let timer = null;

		const cleanup = () => {
			clearTimeout(timer);
			client.removeAllListeners('ready');
			client.removeAllListeners('error');
		};

		const settle = (resolver, value) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			resolver(value);
		};

		timer = setTimeout(() => {
			client.end();
			settle(
				reject,
				normalizeRemoteError(`SSH connection to ${server.name} timed out after ${timeoutMs}ms.`, {
					kind: 'connect-timeout'
				})
			);
		}, timeoutMs);

		client
			.on('ready', () => settle(resolve, client))
			.on('error', (error) => {
				client.end();
				settle(
					reject,
					normalizeRemoteError(`SSH connection to ${server.name} failed: ${error.message}`, {
						kind: 'connect-error'
					})
				);
			})
			.connect({
				host: server.host,
				port: server.port,
				username: server.username,
				privateKey,
				readyTimeout: timeoutMs
			});
	});
}

function buildRemoteLogFile(service) {
	if (service.remoteLogFile) {
		return shellQuote(service.remoteLogFile);
	}

	return quoteRemotePath(`$HOME/.opspanel/logs/${sanitizeId(service.id)}.log`);
}

function buildActionCommand(service, action) {
	const workdir = shellQuote(service.workingDirectory || '.');
	const remoteLogFile = buildRemoteLogFile(service);

	if (action === 'start') {
		const detachedCommand = `exec ${service.startCommand} >> ${remoteLogFile} 2>&1`;

		return [
			'mkdir -p "$HOME/.opspanel/logs"',
			`cd ${workdir}`,
			`setsid sh -lc ${shellQuote(detachedCommand)} >/dev/null 2>&1 < /dev/null & echo $!`
		].join(' && ');
	}

	if (action === 'stop') {
		return [`cd ${workdir}`, service.stopCommand].join(' && ');
	}

	throw new Error(`Unsupported SSH action: ${action}`);
}

function buildLogCommand(service) {
	const workdir = shellQuote(service.workingDirectory || '.');
	const remoteLogFile = buildRemoteLogFile(service);

	if (service.logCommand) {
		return [`cd ${workdir}`, service.logCommand].join(' && ');
	}

	return [
		'mkdir -p "$HOME/.opspanel/logs"',
		`touch ${remoteLogFile}`,
		`tail -n 0 -F ${remoteLogFile}`
	].join(' && ');
}

function buildStatusCommand(service) {
	const workdir = shellQuote(service.workingDirectory || '.');
	return [`cd ${workdir}`, `sh -lc ${shellQuote(service.statusCommand)}`].join(' && ');
}

function normalizeStatusOutput(output) {
	const normalized = String(output || '').trim().toLowerCase();
	return VALID_SERVICE_STATES.has(normalized) ? normalized : null;
}

function formatCommandFailure(result, kind = 'command-error') {
	const detail =
		result.stderr || result.stdout || `Remote command failed with exit code ${result.code ?? 'unknown'}.`;

	return normalizeRemoteError(detail, {
		kind,
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr
	});
}

async function executeRemoteCommand(server, command, { timeoutMs = SSH_STOP_TIMEOUT_MS } = {}) {
	const client = await connect(server, SSH_CONNECT_TIMEOUT_MS);

	return new Promise((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		let settled = false;
		let timer = null;
		let streamRef = null;

		const cleanup = () => {
			clearTimeout(timer);
			try {
				streamRef?.close();
			} catch {
				// Ignore channel close errors during teardown.
			}
			client.end();
		};

		const settle = (resolver, value) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			resolver(value);
		};

		client.exec(command, (error, stream) => {
			if (error) {
				settle(
					reject,
					normalizeRemoteError(`Failed to execute remote command on ${server.name}: ${error.message}`, {
						kind: 'exec-error'
					})
				);
				return;
			}

			streamRef = stream;

			if (timeoutMs) {
				timer = setTimeout(() => {
					settle(
						reject,
						normalizeRemoteError(`Remote command timed out after ${timeoutMs}ms.`, {
							kind: 'command-timeout',
							stdout: stdout.trim(),
							stderr: stderr.trim()
						})
					);
				}, timeoutMs);
			}

			stream.on('data', (chunk) => {
				stdout += chunk.toString();
			});

			stream.stderr.on('data', (chunk) => {
				stderr += chunk.toString();
			});

			stream.on('close', (code, signal) => {
				const result = {
					code,
					signal,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim()
				};

				if (code === 0) {
					settle(resolve, result);
					return;
				}

				settle(reject, formatCommandFailure(result));
			});
		});
	});
}

function drainBufferedLines(buffer, source, serviceId, state, hooks) {
	const segments = buffer.split(/\r?\n/);
	const remainder = segments.pop() || '';

	for (const segment of segments) {
		const entry = state.appendLog(serviceId, segment, { source });
		if (entry) {
			hooks.onLine?.(entry);
		}
	}

	return remainder;
}

export async function runSshAction(service, server, state, action) {
	try {
		const timeoutMs = action === 'start' ? SSH_START_TIMEOUT_MS : SSH_STOP_TIMEOUT_MS;
		const result = await executeRemoteCommand(server, buildActionCommand(service, action), {
			timeoutMs
		});

		state.appendLog(
			service.id,
			`[ssh] ${service.name} ${action === 'start' ? 'start' : 'stop'} command completed on ${server.name}`,
			{ source: 'ssh' }
		);

		if (result.output) {
			state.appendLog(service.id, result.output, { source: 'ssh' });
		}

		return {
			message: result.output || `${service.name} ${action} command completed.`
		};
	} catch (error) {
		if (action === 'start' && error.kind === 'command-timeout') {
			state.appendLog(
				service.id,
				`[ssh] ${service.name} start command did not close within ${SSH_START_TIMEOUT_MS}ms; verifying remote status.`,
				{ source: 'ssh' }
			);
		} else {
			state.appendLog(service.id, `[ssh] ${service.name} action failed: ${error.message}`, {
				source: 'ssh'
			});
		}

		throw error;
	}
}

export async function readSshStatus(service, server) {
	const lastCheckedAt = new Date().toISOString();

	try {
		const result = await executeRemoteCommand(server, buildStatusCommand(service), {
			timeoutMs: SSH_STATUS_TIMEOUT_MS
		});
		const normalizedState = normalizeStatusOutput(result.stdout);

		if (!normalizedState) {
			return {
				state: 'unknown',
				note: `Invalid status output: ${result.stdout || '(empty)'}`,
				lastCheckedAt
			};
		}

		return {
			state: normalizedState,
			note: null,
			lastCheckedAt
		};
	} catch (error) {
		return {
			state: 'unknown',
			note: error.message,
			lastCheckedAt
		};
	}
}

export async function openSshLogStream(service, server, state, hooks, signal) {
	const client = await connect(server, SSH_CONNECT_TIMEOUT_MS);
	let stdoutBuffer = '';
	let stderrBuffer = '';
	let streamRef = null;
	let closed = false;

	const cleanup = () => {
		if (closed) {
			return;
		}

		closed = true;

		if (stdoutBuffer) {
			const entry = state.appendLog(service.id, stdoutBuffer, { source: 'stdout' });
			if (entry) {
				hooks.onLine?.(entry);
			}
		}

		if (stderrBuffer) {
			const entry = state.appendLog(service.id, stderrBuffer, { source: 'stderr' });
			if (entry) {
				hooks.onLine?.(entry);
			}
		}

		try {
			streamRef?.close();
		} catch {
			// Ignore channel close errors during teardown.
		}

		client.end();
		hooks.onEnd?.();
	};

	if (signal) {
		signal.addEventListener('abort', cleanup, { once: true });
	}

	try {
		await new Promise((resolve, reject) => {
			client.exec(buildLogCommand(service), (error, stream) => {
				if (error) {
					reject(error);
					return;
				}

				streamRef = stream;

				stream.on('data', (chunk) => {
					stdoutBuffer += chunk.toString();
					stdoutBuffer = drainBufferedLines(stdoutBuffer, 'stdout', service.id, state, hooks);
				});

				stream.stderr.on('data', (chunk) => {
					stderrBuffer += chunk.toString();
					stderrBuffer = drainBufferedLines(stderrBuffer, 'stderr', service.id, state, hooks);
				});

				stream.on('close', cleanup);
				resolve();
			});
		});
	} catch (error) {
		cleanup();
		throw error;
	}

	return cleanup;
}
