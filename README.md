# OpsPanel MVP

OpsPanel is an internal web panel for running dev services, stopping them, and reading logs without opening SSH sessions manually.

## Implemented MVP

- Single-user login with signed cookie session
- Services dashboard with status, single actions, and bulk start/stop
- Realtime log page using server-sent events
- Executor abstraction with `mock` mode and real `ssh` mode
- Config-driven servers and services from JSON

## Local setup

1. Install dependencies.
```sh
npm install
```

2. Copy the environment example.
```sh
copy .env.example .env
```

3. Copy the config example if you want to replace the built-in sample config.
```sh
copy opspanel.config.example.json opspanel.config.json
```

4. Start the app.
```sh
npm run dev
```

5. Open the app and log in with the credentials from `.env`.

## Configuration

### Environment variables

- `OPSPANEL_EXECUTOR`: `mock` or `ssh`
- `OPSPANEL_CONFIG_PATH`: path to the JSON config file
- `OPSPANEL_LOGIN_USERNAME`: single-user login name
- `OPSPANEL_LOGIN_PASSWORD`: single-user login password
- `OPSPANEL_SESSION_SECRET`: signing secret for the session cookie

### JSON config

`opspanel.config.json` contains:

- `servers`: SSH connection targets
- `services`: service definitions with working directory and commands

Example server authentication options:

- `privateKeyPath`: absolute path to a private key file
- `privateKeyEnv`: environment variable containing the private key contents
- `privateKey`: inline private key string

Required service fields:

- `startCommand`
- `stopCommand`
- `statusCommand`

`statusCommand` must print exactly one of `running`, `stopped`, `failed`, or `unknown` on stdout.

## SSH mode notes

- `mock` mode is the default so the UI works without server access.
- In `ssh` mode, start commands are launched with `nohup` and output is written to `~/.opspanel/logs/<service>.log` unless the service provides its own `logCommand`.
- Service status is now refreshed from the remote host via `statusCommand`, with a short 5 second cache to avoid flooding SSH requests.

## Verify

```sh
npm run build
```
