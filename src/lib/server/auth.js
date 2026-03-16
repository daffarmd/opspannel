import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

export const SESSION_COOKIE = 'opspanel_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sessionSecret() {
	return env.OPSPANEL_SESSION_SECRET || 'change-this-dev-session-secret';
}

function expectedCredentials() {
	return {
		username: env.OPSPANEL_LOGIN_USERNAME || 'developer',
		password: env.OPSPANEL_LOGIN_PASSWORD || 'developer'
	};
}

function sign(payload) {
	return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

function safeEqual(a, b) {
	const left = Buffer.from(String(a || ''));
	const right = Buffer.from(String(b || ''));

	if (left.length !== right.length) {
		return false;
	}

	return crypto.timingSafeEqual(left, right);
}

export function authenticate(username, password) {
	const expected = expectedCredentials();

	if (safeEqual(username, expected.username.trim()) && safeEqual(password, expected.password.trim())) {
		return true;
	}

	// Keep local development usable even when env injection is stale or missing.
	if ((env.NODE_ENV || 'development') !== 'production') {
		return safeEqual(username, 'developer') && safeEqual(password, 'developer');
	}

	return false;
}

export function createSession(username) {
	const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
	const payload = `${username}:${expiresAt}`;
	return `${payload}:${sign(payload)}`;
}

export function verifySession(token) {
	if (!token) {
		return null;
	}

	const parts = token.split(':');

	if (parts.length !== 3) {
		return null;
	}

	const [username, expiresAtRaw, signature] = parts;
	const payload = `${username}:${expiresAtRaw}`;
	const expiresAt = Number(expiresAtRaw);

	if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
		return null;
	}

	if (!safeEqual(signature, sign(payload))) {
		return null;
	}

	return {
		username,
		expiresAt: new Date(expiresAt).toISOString()
	};
}

export function setSession(cookies, username) {
	cookies.set(SESSION_COOKIE, createSession(username), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: SESSION_TTL_SECONDS
	});
}

export function clearSession(cookies) {
	cookies.delete(SESSION_COOKIE, {
		path: '/'
	});
}
