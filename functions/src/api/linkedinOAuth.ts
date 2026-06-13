import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";

/**
 * LinkedIn OAuth 2.0 "Connect with LinkedIn" (authorization-code) flow.
 *
 * Required Firebase secrets (firebase-functions v2 — declare in the function's
 * `secrets: [...]` option and read from process.env):
 *   - LINKEDIN_CLIENT_ID:     The OAuth 2.0 Client ID from the LinkedIn app's Auth tab.
 *   - LINKEDIN_CLIENT_SECRET: The OAuth 2.0 Client Secret from the same tab.
 *   - LINKEDIN_REDIRECT_URI:  The deployed `linkedinOAuthCallback` URL. MUST be byte-for-byte
 *                             identical to one of the LinkedIn app's "Authorized redirect URLs".
 *   - DASHBOARD_URL:          The base URL of the deployed web app (e.g. https://app.example.com),
 *                             used to redirect the browser back to /settings after the callback.
 *
 * Set them with:
 *   firebase functions:secrets:set LINKEDIN_CLIENT_ID
 *   firebase functions:secrets:set LINKEDIN_CLIENT_SECRET
 *   firebase functions:secrets:set LINKEDIN_REDIRECT_URI
 *   firebase functions:secrets:set DASHBOARD_URL
 */

const LINKEDIN_SECRETS = [
	"LINKEDIN_CLIENT_ID",
	"LINKEDIN_CLIENT_SECRET",
	"LINKEDIN_REDIRECT_URI",
	"DASHBOARD_URL",
];

// Member (personal profile) scopes — required for userinfo + publishing as a person.
const MEMBER_SCOPES = ["openid", "profile", "email", "w_member_social"];
// Organization (Page) scopes — only granted to apps approved for the Community Management API.
const ORG_SCOPES = ["w_organization_social", "r_organization_admin"];

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Step 1 — generate the LinkedIn authorize URL.
 * Stores a short-lived state doc (Admin SDK, so it bypasses Firestore rules) tying the
 * random `state` to the requesting uid, and returns the authorize URL for the client to
 * redirect to.
 */
export const linkedinOAuthStart = onCall({ cors: true, secrets: LINKEDIN_SECRETS }, async (request) => {
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "User must be logged in.");
	}

	const clientId = process.env.LINKEDIN_CLIENT_ID;
	const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
	if (!clientId || !redirectUri) {
		throw new HttpsError("failed-precondition", "LinkedIn OAuth is not configured on the server.");
	}

	const includeOrgScopes = request.data?.includeOrgScopes === true;
	const scopes = includeOrgScopes ? [...MEMBER_SCOPES, ...ORG_SCOPES] : MEMBER_SCOPES;

	// Cryptographically-random state to protect against CSRF.
	const state = randomUUID();

	await admin.firestore().doc(`linkedinOauthStates/${state}`).set({
		uid: request.auth.uid,
		includeOrgScopes,
		createdAt: admin.firestore.FieldValue.serverTimestamp(),
	});

	const params = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		state,
		scope: scopes.join(" "),
	});

	const authorizeUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
	return { authorizeUrl };
});

/**
 * Step 2 — the registered redirect_uri. LinkedIn sends the browser here with `code` & `state`.
 * Exchanges the code for tokens, fetches the member's profile, persists everything onto the
 * user doc, then redirects the browser back to the dashboard Settings page.
 */
export const linkedinOAuthCallback = onRequest({ secrets: LINKEDIN_SECRETS }, async (req, res) => {
	const dashboardUrl = (process.env.DASHBOARD_URL || "").replace(/\/+$/, "");
	const settingsUrl = `${dashboardUrl}/settings`;

	const redirectError = (reason: string) => {
		res.redirect(302, `${settingsUrl}?linkedin=error&reason=${encodeURIComponent(reason)}`);
	};

	try {
		const code = typeof req.query.code === "string" ? req.query.code : undefined;
		const state = typeof req.query.state === "string" ? req.query.state : undefined;
		const oauthError = typeof req.query.error === "string" ? req.query.error : undefined;

		// 1. The user denied consent (or LinkedIn returned an error).
		if (oauthError) {
			const desc = typeof req.query.error_description === "string" ? req.query.error_description : oauthError;
			redirectError(desc);
			return;
		}

		if (!code || !state) {
			redirectError("missing_code_or_state");
			return;
		}

		// 2. Validate the state and resolve the uid.
		const stateRef = admin.firestore().doc(`linkedinOauthStates/${state}`);
		const stateSnap = await stateRef.get();
		if (!stateSnap.exists) {
			redirectError("invalid_state");
			return;
		}
		const stateData = stateSnap.data() || {};
		const uid: string | undefined = stateData.uid;
		const createdAt = stateData.createdAt?.toMillis ? stateData.createdAt.toMillis() : 0;

		// One-time use: delete regardless of outcome from here on.
		await stateRef.delete();

		if (!uid) {
			redirectError("invalid_state");
			return;
		}
		if (!createdAt || Date.now() - createdAt > STATE_TTL_MS) {
			redirectError("expired_state");
			return;
		}

		const clientId = process.env.LINKEDIN_CLIENT_ID;
		const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
		const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
		if (!clientId || !clientSecret || !redirectUri) {
			redirectError("server_not_configured");
			return;
		}

		// 3. Exchange the authorization code for tokens.
		const tokenBody = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			client_secret: clientSecret,
		});

		const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: tokenBody.toString(),
		});

		if (!tokenResponse.ok) {
			// Avoid logging the body — it can echo back parts of the request. Log status only.
			console.error("LinkedIn token exchange failed:", tokenResponse.status);
			redirectError("token_exchange_failed");
			return;
		}

		const tokenJson: any = await tokenResponse.json();
		const accessToken: string | undefined = tokenJson.access_token;
		const expiresIn: number = Number(tokenJson.expires_in) || 0;
		const refreshToken: string | undefined = tokenJson.refresh_token;

		if (!accessToken) {
			redirectError("no_access_token");
			return;
		}

		// 4. Fetch the member's profile to derive the URN and display name.
		const userinfoResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (!userinfoResponse.ok) {
			console.error("LinkedIn userinfo failed:", userinfoResponse.status);
			redirectError("userinfo_failed");
			return;
		}

		const profile: any = await userinfoResponse.json();
		const name: string = profile.name || "LinkedIn User";
		const sub: string | undefined = profile.sub;
		if (!sub) {
			redirectError("no_profile_id");
			return;
		}

		// 5. Persist onto the user doc (same fields the rest of the app already reads).
		const update: Record<string, unknown> = {
			linkedInAccessToken: accessToken,
			linkedInUrn: `urn:li:person:${sub}`,
			linkedInUsername: name,
			linkedInConnectedAt: admin.firestore.FieldValue.serverTimestamp(),
			linkedInTokenExpiresAt: Date.now() + expiresIn * 1000,
		};
		if (refreshToken) {
			update.linkedInRefreshToken = refreshToken;
		}

		await admin.firestore().doc(`users/${uid}`).set(update, { merge: true });

		// 6. Back to the dashboard with a success flag.
		res.redirect(302, `${settingsUrl}?linkedin=connected`);
	} catch (error: any) {
		console.error("LinkedIn OAuth callback error:", error?.message || error);
		redirectError("internal_error");
	}
});

/**
 * Optional refresh flow. LinkedIn only issues refresh tokens to apps that have been approved
 * for programmatic refresh; most apps will not have one stored. This stays graceful: it returns
 * `{ success: false, reason: 'no_refresh_token' }` rather than throwing when there's nothing to refresh.
 */
export const refreshLinkedInToken = onCall({ cors: true, secrets: LINKEDIN_SECRETS }, async (request) => {
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "User must be logged in.");
	}
	const uid = request.auth.uid;

	const userRef = admin.firestore().doc(`users/${uid}`);
	const userSnap = await userRef.get();
	const refreshToken: string | undefined = userSnap.data()?.linkedInRefreshToken;

	if (!refreshToken) {
		return { success: false, reason: "no_refresh_token" };
	}

	const clientId = process.env.LINKEDIN_CLIENT_ID;
	const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new HttpsError("failed-precondition", "LinkedIn OAuth is not configured on the server.");
	}

	try {
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
		});

		const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});

		if (!response.ok) {
			console.error("LinkedIn refresh failed:", response.status);
			throw new HttpsError("permission-denied", "Failed to refresh LinkedIn token. Please reconnect.");
		}

		const json: any = await response.json();
		const accessToken: string | undefined = json.access_token;
		const expiresIn: number = Number(json.expires_in) || 0;
		const newRefreshToken: string | undefined = json.refresh_token;

		if (!accessToken) {
			throw new HttpsError("internal", "LinkedIn did not return a new access token.");
		}

		const expiresAt = Date.now() + expiresIn * 1000;
		const update: Record<string, unknown> = {
			linkedInAccessToken: accessToken,
			linkedInTokenExpiresAt: expiresAt,
		};
		if (newRefreshToken) {
			update.linkedInRefreshToken = newRefreshToken;
		}
		await userRef.set(update, { merge: true });

		return { success: true, expiresAt };
	} catch (error: any) {
		if (error instanceof HttpsError) {
			throw error;
		}
		console.error("LinkedIn refresh error:", error?.message || error);
		throw new HttpsError("internal", "Failed to refresh LinkedIn token.");
	}
});
