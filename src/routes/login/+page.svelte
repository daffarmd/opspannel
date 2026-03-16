<script>
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Login | OpsPanel</title>
	<meta name="description" content="Single-user login for OpsPanel." />
</svelte:head>

<div class="page-shell" style="max-width: 960px;">
	<section class="hero-grid" style="grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr);">
		<div class="panel">
			<div class="panel-content">
				<div class="eyebrow">OpsPanel Access</div>
				<h1 class="hero-title">One panel for dev service control.</h1>
				<p class="hero-copy">
					This MVP protects the dashboard with a single operator login. Commands remain restricted to
					registered start, stop, and log actions only.
				</p>

				<div class="summary-grid" style="margin-top: 24px;">
					<article class="summary-card">
						<div class="summary-label">Security baseline</div>
						<h2>Whitelisted</h2>
						<div class="muted-copy">No arbitrary terminal access from the browser.</div>
					</article>
					<article class="summary-card alt">
						<div class="summary-label">Execution mode</div>
						<h2>SSH / Mock</h2>
						<div class="muted-copy">Switch via `OPSPANEL_EXECUTOR` without changing the UI.</div>
					</article>
				</div>
			</div>
		</div>

		<div class="panel">
			<div class="panel-content">
				<p class="section-kicker">Sign in</p>
				<h2 class="section-title">Dashboard login</h2>
				<p class="helper-text">
					Use the credentials from `OPSPANEL_LOGIN_USERNAME` and `OPSPANEL_LOGIN_PASSWORD`.
				</p>

				<form method="POST" style="display: grid; gap: 14px; margin-top: 24px;">
					<input type="hidden" name="next" value={form?.next || data.next} />

					<label style="display: grid; gap: 8px;">
						<span class="section-kicker" style="margin: 0;">Username</span>
						<input
							name="username"
							type="text"
							autocomplete="username"
							required
							value={form?.username || ''}
							style="min-height: 48px; border-radius: 16px; border: 1px solid var(--line); padding: 0 16px; background: var(--surface-strong);"
						/>
					</label>

					<label style="display: grid; gap: 8px;">
						<span class="section-kicker" style="margin: 0;">Password</span>
						<input
							name="password"
							type="password"
							autocomplete="current-password"
							required
							style="min-height: 48px; border-radius: 16px; border: 1px solid var(--line); padding: 0 16px; background: var(--surface-strong);"
						/>
					</label>

					{#if form?.error}
						<div class="notice error">{form.error}</div>
					{/if}

					<button class="button accent" type="submit">Enter dashboard</button>
				</form>
			</div>
		</div>
	</section>
</div>
