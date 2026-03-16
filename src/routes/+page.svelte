<script>
	import { onMount, untrack } from 'svelte';

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

	let title = $state(seed.title);
	let services = $state(seed.services);
	let summary = $state(seed.summary);
	let executorMode = $state(seed.executorMode);
	let configSource = $state(seed.configSource);
	let selectedIds = $state([]);
	let busyByService = $state({});
	let bulkBusy = $state(false);
	let feedback = $state(null);
	const actionPollers = new Map();

	function isSelected(serviceId) {
		return selectedIds.includes(serviceId);
	}

	function toggleSelection(serviceId) {
		selectedIds = isSelected(serviceId)
			? selectedIds.filter((item) => item !== serviceId)
			: [...selectedIds, serviceId];
	}

	function toggleAll() {
		selectedIds = selectedIds.length === services.length ? [] : services.map((service) => service.id);
	}

	function formatTimestamp(value, fallback = 'Not yet updated') {
		if (!value) {
			return fallback;
		}

		return new Intl.DateTimeFormat('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
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

	async function refreshDashboard(silent = false) {
		try {
			const response = await fetch('/api/services');
			const payload = await readPayload(response);

			if (!response.ok) {
				throw new Error(payload.message || 'Unable to refresh dashboard.');
			}

			title = payload.title;
			services = payload.services;
			summary = payload.summary;
			executorMode = payload.executorMode;
			configSource = payload.configSource;
			selectedIds = selectedIds.filter((serviceId) =>
				payload.services.some((service) => service.id === serviceId)
			);

			const nextBusyByService = { ...busyByService };

			for (const service of payload.services) {
				const pendingAction = nextBusyByService[service.id];
				const settled =
					(pendingAction === 'start' && service.status.state === 'running') ||
					(pendingAction === 'stop' && service.status.state === 'stopped');

				if (settled) {
					nextBusyByService[service.id] = null;

					const activePoller = actionPollers.get(service.id);

					if (activePoller) {
						clearInterval(activePoller);
						actionPollers.delete(service.id);
					}
				}
			}

			busyByService = nextBusyByService;

			if (!silent) {
				feedback = {
					tone: 'success',
					message: 'Dashboard refreshed.'
				};
			}
		} catch (error) {
			if (!silent) {
				feedback = {
					tone: 'error',
					message: error.message
				};
			}
		}
	}

	async function handleAction(serviceId, action) {
		busyByService = {
			...busyByService,
			[serviceId]: action
		};
		const poller = setInterval(() => {
			refreshDashboard(true);
		}, 1000);

		actionPollers.set(serviceId, poller);

		try {
			const response = await fetch(`/api/services/${serviceId}/action`, {
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

			await refreshDashboard(true);
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
			const activePoller = actionPollers.get(serviceId);

			if (activePoller) {
				clearInterval(activePoller);
				actionPollers.delete(serviceId);
			}

			busyByService = {
				...busyByService,
				[serviceId]: null
			};
		}
	}

	async function handleBulkAction(action) {
		if (selectedIds.length === 0) {
			return;
		}

		bulkBusy = true;

		try {
			const response = await fetch('/api/services/bulk', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					action,
					serviceIds: selectedIds
				})
			});
			const payload = await readPayload(response);

			if (!response.ok) {
				throw new Error(payload.message || `${action} failed.`);
			}

			const failures = payload.results.filter((result) => !result.ok);
			await refreshDashboard(true);
			feedback = {
				tone: failures.length ? 'error' : 'success',
				message: failures.length
					? `${failures.length} service action failed.`
					: `${payload.results.length} service(s) synchronized after ${action}.`
			};
		} catch (error) {
			feedback = {
				tone: 'error',
				message: error.message
			};
		} finally {
			bulkBusy = false;
		}
	}

	onMount(() => {
		const interval = setInterval(() => {
			refreshDashboard(true);
		}, 10000);

		return () => {
			clearInterval(interval);

			for (const poller of actionPollers.values()) {
				clearInterval(poller);
			}

			actionPollers.clear();
		};
	});

	const selectedCount = $derived(selectedIds.length);
	const allSelected = $derived(services.length > 0 && selectedIds.length === services.length);
</script>

<svelte:head>
	<title>{title} | OpsPanel</title>
	<meta
		name="description"
		content="Internal OpsPanel dashboard for starting, stopping, and inspecting development services."
	/>
</svelte:head>

<div class="page-shell">
	<section class="hero-grid">
		<div class="panel">
			<div class="panel-content">
				<div class="eyebrow">Internal Service Control</div>
				<h1 class="hero-title">{title}</h1>
				<p class="hero-copy">
					Start, stop, and inspect registered dev services without opening SSH sessions. Only saved
					commands are executable from this panel.
				</p>

				<div class="meta-strip">
					<div class="chip">{executorMode === 'ssh' ? 'SSH executor enabled' : 'Mock executor enabled'}</div>
					<div class="chip">Config source: {configSource}</div>
					{#if data.user}
						<div class="chip">Signed in as {data.user.username}</div>
					{/if}
				</div>

				<div class="toolbar">
					<button class="button secondary" onclick={() => refreshDashboard()} type="button">
						Refresh
					</button>
					<button class="button secondary" onclick={toggleAll} type="button">
						{allSelected ? 'Clear selection' : 'Select all'}
					</button>
					<button
						class="button accent"
						type="button"
						disabled={selectedCount === 0 || bulkBusy}
						onclick={() => handleBulkAction('start')}
					>
						{bulkBusy ? 'Dispatching...' : `Start selected (${selectedCount})`}
					</button>
					<button
						class="button danger"
						type="button"
						disabled={selectedCount === 0 || bulkBusy}
						onclick={() => handleBulkAction('stop')}
					>
						Stop selected
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

		<div class="summary-grid">
			<article class="summary-card">
				<div class="summary-label">Registered services</div>
				<h2>{summary.total}</h2>
				<div class="muted-copy">All services available from this dashboard.</div>
			</article>
			<article class="summary-card alt">
				<div class="summary-label">Running now</div>
				<h2>{summary.running}</h2>
				<div class="muted-copy">Services currently marked as active.</div>
			</article>
			<article class="summary-card warn">
				<div class="summary-label">Needs attention</div>
				<h2>{summary.attention}</h2>
				<div class="muted-copy">Unknown, transitional, or failed service states.</div>
			</article>
		</div>
	</section>

	<div class="section-head">
		<div>
			<p class="section-kicker">Services</p>
			<h2 class="section-title">Command center</h2>
		</div>

	</div>

	{#if services.length === 0}
		<div class="empty-state">
			<p class="section-copy">
				No services configured yet. Add an `opspanel.config.json` file to replace the built-in sample
				config and register your servers and commands.
			</p>
		</div>
	{:else}
		<div class="service-grid">
			{#each services as service}
				<article class="service-card">
					<div class="service-card-top">
						<label class="checkbox">
							<input
								type="checkbox"
								checked={isSelected(service.id)}
								onchange={() => toggleSelection(service.id)}
							/>
							<span>Select</span>
						</label>
						<div class:status-pill={true} class={service.status.state}>
							{statusLabels[service.status.state] || service.status.state}
						</div>
					</div>

					<div>
						<h3 class="service-name">{service.name}</h3>
						<p class="service-desc">{service.description}</p>
					</div>

					<dl class="meta-grid">
						<div class="meta-block">
							<dt>Server</dt>
							<dd>{service.server.name}</dd>
						</div>
						<div class="meta-block">
							<dt>Directory</dt>
							<dd class="mono">{service.workingDirectory}</dd>
						</div>
						<div class="meta-block">
							<dt>Host</dt>
							<dd class="mono">{service.server.username}@{service.server.host}:{service.server.port}</dd>
						</div>
						<div class="meta-block">
							<dt>Last update</dt>
							<dd>{formatTimestamp(service.status.updatedAt)}</dd>
						</div>
						<div class="meta-block">
							<dt>Last checked</dt>
							<dd>{formatTimestamp(service.lastCheckedAt, 'Never checked')}</dd>
						</div>
						<div class="meta-block">
							<dt>Last result</dt>
							<dd>{service.status.lastResult || 'Not executed yet'}</dd>
						</div>
					</dl>

					<dl class="command-stack">
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
					</dl>

					{#if service.status.note}
						<p class="status-note">{service.status.note}</p>
					{/if}

					<div class="service-actions">
						<button
							class="button accent"
							type="button"
							disabled={busyByService[service.id] || ['running', 'starting'].includes(service.status.state)}
							onclick={() => handleAction(service.id, 'start')}
						>
							{busyByService[service.id] === 'start' ? 'Starting...' : 'Start'}
						</button>
						<button
							class="button danger"
							type="button"
							disabled={busyByService[service.id] || ['stopped', 'stopping'].includes(service.status.state)}
							onclick={() => handleAction(service.id, 'stop')}
						>
							{busyByService[service.id] === 'stop' ? 'Stopping...' : 'Stop'}
						</button>
						<a class="button ghost" href={`/logs/${service.id}`}>Open logs</a>
					</div>

					<div class="service-foot">
						<span>Authoritative state: {statusLabels[service.status.state] || service.status.state}</span>
						<span class="mono">{service.id}</span>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>
