<script>
	import { onMount, tick, untrack } from 'svelte';

	let { data } = $props();
	const seed = untrack(() => structuredClone(data));

	const statusLabels = {
		running: 'Running',
		stopped: 'Stopped',
		failed: 'Failed',
		starting: 'Starting',
		stopping: 'Stopping',
		unknown: 'Unknown',
		error: 'Needs Attention'
	};

	const streamLabels = {
		connecting: 'Connecting',
		live: 'Live stream',
		degraded: 'Reconnecting',
		ended: 'Ended'
	};

	let service = $state(seed.service);
	let logs = $state(seed.initialLogs);
	let streamState = $state('connecting');
	let busyAction = $state(null);
	let feedback = $state(null);
	let logViewport;
	let source;

	function formatTimestamp(value) {
		if (!value) {
			return '--';
		}

		return new Intl.DateTimeFormat('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).format(new Date(value));
	}

	async function scrollToBottom() {
		await tick();

		if (logViewport) {
			logViewport.scrollTop = logViewport.scrollHeight;
		}
	}

	async function readPayload(response) {
		const contentType = response.headers.get('content-type') || '';

		if (contentType.includes('application/json')) {
			return response.json();
		}

		return {
			message: await response.text()
		};
	}

	async function refreshService() {
		try {
			const response = await fetch(`/api/services/${service.id}`);
			const payload = await readPayload(response);

			if (!response.ok) {
				throw new Error(payload.message || 'Unable to refresh service.');
			}

			service = payload.service;
		} catch (error) {
			feedback = {
				tone: 'error',
				message: error.message
			};
		}
	}

	async function handleAction(action) {
		busyAction = action;

		try {
			const response = await fetch(`/api/services/${service.id}/action`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action })
			});
			const payload = await readPayload(response);

			if (!response.ok) {
				throw new Error(payload.message || `${action} failed.`);
			}

			service = payload.service;
			feedback = {
				tone: 'success',
				message: payload.result.message
			};
		} catch (error) {
			feedback = {
				tone: 'error',
				message: error.message
			};
		} finally {
			busyAction = null;
		}
	}

	function connectLogs() {
		source?.close();
		streamState = 'connecting';

		source = new EventSource(`/api/services/${service.id}/logs`);
		source.addEventListener('ready', () => {
			streamState = 'live';
		});
		source.addEventListener('snapshot', async (event) => {
			const payload = JSON.parse(event.data);
			logs = payload.entries.slice(-400);
			await scrollToBottom();
		});
		source.addEventListener('line', async (event) => {
			const payload = JSON.parse(event.data);
			logs = [...logs, payload].slice(-400);
			await scrollToBottom();
		});
		source.addEventListener('end', () => {
			streamState = 'ended';
			source?.close();
		});
		source.addEventListener('error', () => {
			streamState = 'degraded';
		});
	}

	onMount(() => {
		connectLogs();
		scrollToBottom();

		const interval = setInterval(() => {
			refreshService();
		}, 10000);

		return () => {
			clearInterval(interval);
			source?.close();
		};
	});
</script>

<svelte:head>
	<title>{service.name} Logs | OpsPanel</title>
	<meta name="description" content={`Realtime logs for ${service.name} in OpsPanel.`} />
</svelte:head>

<div class="page-shell">
	<a class="back-link" href="/">&larr; Back to dashboard</a>

	<section class="log-grid">
		<div class="side-stack">
			<div class="panel">
				<div class="panel-content">
					<div class="eyebrow">Realtime log viewer</div>
					<h1 class="log-title">{service.name}</h1>
					<p class="hero-copy">
						Streaming logs for {service.server.name}. Use the same registered commands from the
						dashboard without opening a shell session.
					</p>

					<div class="chip-row" style="margin-top: 20px;">
						<div class:status-indicator={true} class={service.status.state}>
							{statusLabels[service.status.state] || service.status.state}
						</div>
						<div class="stream-indicator">{streamLabels[streamState]}</div>
						<div class="chip">{data.executorMode === 'ssh' ? 'SSH mode' : 'Mock mode'}</div>
						{#if data.user}
							<div class="chip">Signed in as {data.user.username}</div>
						{/if}
					</div>

					<div class="toolbar">
						<button
							class="button accent"
							type="button"
							disabled={busyAction || ['running', 'starting'].includes(service.status.state)}
							onclick={() => handleAction('start')}
						>
							{busyAction === 'start' ? 'Starting...' : 'Start'}
						</button>
						<button
							class="button danger"
							type="button"
							disabled={busyAction || ['stopped', 'stopping'].includes(service.status.state)}
							onclick={() => handleAction('stop')}
						>
							{busyAction === 'stop' ? 'Stopping...' : 'Stop'}
						</button>
						<button class="button secondary" type="button" onclick={connectLogs}>
							Reconnect logs
						</button>
						<form method="POST" action="/logout">
							<button class="button secondary" type="submit">Logout</button>
						</form>
					</div>

					{#if feedback}
						<div class:notice={true} class:error={feedback.tone === 'error'}>
							{feedback.message}
						</div>
					{/if}
				</div>
			</div>

			<div class="panel">
				<div class="panel-content">
					<p class="section-kicker">Service details</p>
					<dl class="command-stack">
						<div class="command-card">
							<dt>Server</dt>
							<dd class="mono">{service.server.username}@{service.server.host}:{service.server.port}</dd>
						</div>
						<div class="command-card">
							<dt>Working directory</dt>
							<dd class="mono">{service.workingDirectory}</dd>
						</div>
						<div class="command-card">
							<dt>Start command</dt>
							<dd class="mono">{service.startCommand}</dd>
						</div>
						<div class="command-card">
							<dt>Stop command</dt>
							<dd class="mono">{service.stopCommand}</dd>
						</div>
						<div class="command-card">
							<dt>Status command</dt>
							<dd class="mono">{service.statusCommand}</dd>
						</div>
						<div class="command-card">
							<dt>Log command</dt>
							<dd class="mono">{service.logCommand || 'tail -F $HOME/.opspanel/logs/<service>.log'}</dd>
						</div>
					</dl>

					<p class="helper-text" style="margin-top: 18px;">
						Last service state update: {service.status.updatedAt
							? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
									new Date(service.status.updatedAt)
								)
							: 'Not available'}
					</p>
					<p class="helper-text">
						Last remote status check: {service.lastCheckedAt
							? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
									new Date(service.lastCheckedAt)
								)
							: 'Never checked'}
					</p>
					{#if service.status.note}
						<p class="status-note" style="margin-top: 12px;">{service.status.note}</p>
					{/if}
				</div>
			</div>
		</div>

		<div class="log-console" bind:this={logViewport}>
			{#if logs.length === 0}
				<div class="log-empty mono">No log lines yet. Start the service or reconnect the stream.</div>
			{:else}
				{#each logs as entry}
					<div class="log-line mono">
						<div class="log-time">{formatTimestamp(entry.at)}</div>
						<div>
							<span class="log-source">{entry.source}</span>{entry.line}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>
</div>
