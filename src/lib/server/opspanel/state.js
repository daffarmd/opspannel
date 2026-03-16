import { EventEmitter } from 'node:events';

const BUFFER_LIMIT = 400;

class OpsPanelState {
	constructor() {
		this.statusByService = new Map();
		this.logsByService = new Map();
		this.emittersByService = new Map();
		this.actionLocksByService = new Map();
	}

	getStatus(serviceId) {
		return (
			this.statusByService.get(serviceId) || {
				state: 'unknown',
				updatedAt: null,
				lastCheckedAt: null,
				lastResult: null,
				lastCommand: null,
				note: null
			}
		);
	}

	setStatus(serviceId, patch) {
		const next = {
			...this.getStatus(serviceId),
			...patch,
			updatedAt: new Date().toISOString()
		};

		this.statusByService.set(serviceId, next);
		return next;
	}

	getLogs(serviceId) {
		return [...(this.logsByService.get(serviceId) || [])];
	}

	appendLog(serviceId, line, meta = {}) {
		const text = String(line ?? '').trimEnd();

		if (!text) {
			return null;
		}

		const entry = {
			line: text,
			at: meta.at || new Date().toISOString(),
			source: meta.source || 'system'
		};
		const nextBuffer = this.getLogs(serviceId);

		nextBuffer.push(entry);

		if (nextBuffer.length > BUFFER_LIMIT) {
			nextBuffer.splice(0, nextBuffer.length - BUFFER_LIMIT);
		}

		this.logsByService.set(serviceId, nextBuffer);
		this.getEmitter(serviceId).emit('line', entry);

		return entry;
	}

	subscribe(serviceId, handler) {
		const emitter = this.getEmitter(serviceId);
		emitter.on('line', handler);
		return () => emitter.off('line', handler);
	}

	getEmitter(serviceId) {
		if (!this.emittersByService.has(serviceId)) {
			this.emittersByService.set(serviceId, new EventEmitter());
		}

		return this.emittersByService.get(serviceId);
	}

	getActionLock(serviceId) {
		return this.actionLocksByService.get(serviceId) || null;
	}

	lockAction(serviceId, action) {
		if (this.actionLocksByService.has(serviceId)) {
			return false;
		}

		this.actionLocksByService.set(serviceId, {
			action,
			lockedAt: new Date().toISOString()
		});

		return true;
	}

	unlockAction(serviceId) {
		this.actionLocksByService.delete(serviceId);
	}
}

const globalKey = '__opspanel_state__';

function upgradeStateSingleton(candidate) {
	const state = candidate instanceof OpsPanelState ? candidate : Object(candidate || {});

	Object.setPrototypeOf(state, OpsPanelState.prototype);

	state.statusByService ??= new Map();
	state.logsByService ??= new Map();
	state.emittersByService ??= new Map();
	state.actionLocksByService ??= new Map();

	return state;
}

export const opsPanelState = upgradeStateSingleton(
	globalThis[globalKey] || (globalThis[globalKey] = new OpsPanelState())
);
