import * as admin from "firebase-admin";

/**
 * Social account model + resolution.
 *
 * Two kinds of LinkedIn target a post can be published to:
 *   - the legacy "personal" profile, stored as scalar fields on the user doc
 *     (linkedInAccessToken / linkedInUrn / linkedInUsername). Its id is "linkedin:personal".
 *   - one or more saved Pages/organizations, stored in the
 *     users/{uid}/socialAccounts/{docId} subcollection. Their id is "acct:{docId}".
 *
 * Posting to a Page reuses the exact same LinkedIn publish flow — only the author
 * URN (urn:li:organization:{id}) and the token differ — so publishService stays
 * almost untouched.
 */

export const PERSONAL_ACCOUNT_ID = "linkedin:personal";

export interface ResolvedAccount {
	id: string;
	provider: "linkedin";
	type: "person" | "organization";
	displayName: string;
	urn: string;
	accessToken: string;
}

export interface PublicAccount {
	id: string;
	provider: "linkedin";
	type: "person" | "organization";
	displayName: string;
	urn: string;
	isDefault: boolean;
	connected: boolean; // has both a urn and a token
}

/**
 * Resolve the owning user. This is a solo-dev app, so — exactly like the GitHub
 * release webhook — the owner is the first (only) document in `users`.
 */
export async function resolveOwnerUserId(db: admin.firestore.Firestore): Promise<string> {
	const snap = await db.collection("users").limit(1).get();
	if (snap.empty) throw new Error("No user is configured in this workspace.");
	return snap.docs[0].id;
}

/** List the accounts a post can be published to (NEVER returns tokens). */
export async function listSocialAccounts(db: admin.firestore.Firestore, uid: string): Promise<PublicAccount[]> {
	const accounts: PublicAccount[] = [];

	const userSnap = await db.doc(`users/${uid}`).get();
	const user = userSnap.exists ? (userSnap.data() as any) : {};
	if (user.linkedInUrn || user.linkedInAccessToken) {
		accounts.push({
			id: PERSONAL_ACCOUNT_ID,
			provider: "linkedin",
			type: "person",
			displayName: user.linkedInUsername || "LinkedIn profile",
			urn: user.linkedInUrn || "",
			isDefault: true,
			connected: !!(user.linkedInUrn && user.linkedInAccessToken),
		});
	}

	const pagesSnap = await db.collection(`users/${uid}/socialAccounts`).get();
	pagesSnap.forEach((doc) => {
		const d = doc.data() as any;
		if (d.provider && d.provider !== "linkedin") return;
		accounts.push({
			id: `acct:${doc.id}`,
			provider: "linkedin",
			type: d.type === "organization" ? "organization" : "person",
			displayName: d.displayName || d.urn || "LinkedIn page",
			urn: d.urn || "",
			isDefault: false,
			connected: !!(d.urn && d.accessToken),
		});
	});

	return accounts;
}

/**
 * Resolve a single account (WITH its token) for publishing. A missing/blank/
 * "default" accountId resolves to the personal profile.
 */
export async function resolveAccount(
	db: admin.firestore.Firestore,
	uid: string,
	accountId?: string,
): Promise<ResolvedAccount> {
	const id = (accountId || "").trim();

	if (!id || id === PERSONAL_ACCOUNT_ID || id === "default") {
		const userSnap = await db.doc(`users/${uid}`).get();
		const user = userSnap.exists ? (userSnap.data() as any) : {};
		if (!user.linkedInAccessToken || !user.linkedInUrn) {
			throw new Error("No personal LinkedIn profile is connected. Connect one in Settings first.");
		}
		return {
			id: PERSONAL_ACCOUNT_ID,
			provider: "linkedin",
			type: "person",
			displayName: user.linkedInUsername || "LinkedIn profile",
			urn: user.linkedInUrn,
			accessToken: user.linkedInAccessToken,
		};
	}

	const docId = id.startsWith("acct:") ? id.slice("acct:".length) : id;
	const snap = await db.doc(`users/${uid}/socialAccounts/${docId}`).get();
	if (!snap.exists) throw new Error(`No connected account matches id "${accountId}".`);
	const d = snap.data() as any;
	if (!d.accessToken || !d.urn) {
		throw new Error(`Account "${d.displayName || docId}" is missing its token or URN.`);
	}
	return {
		id: `acct:${docId}`,
		provider: "linkedin",
		type: d.type === "organization" ? "organization" : "person",
		displayName: d.displayName || d.urn,
		urn: d.urn,
		accessToken: d.accessToken,
	};
}

/**
 * List the LinkedIn Pages (organizations) the token holder administers.
 * Requires the token to carry the `r_organization_admin` (or rw_) scope, which
 * in turn requires the LinkedIn developer app to have the Community Management
 * API product approved. Names are resolved best-effort — if the name lookup is
 * not permitted, the URN is used as the display name.
 */
export async function fetchAdministeredOrganizations(
	token: string,
): Promise<Array<{ urn: string; organizationId: string; name: string }>> {
	const aclRes = await fetch(
		"https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
		{
			headers: {
				Authorization: `Bearer ${token}`,
				"X-Restli-Protocol-Version": "2.0.0",
			},
		},
	);
	if (!aclRes.ok) {
		const body = await aclRes.text();
		if (aclRes.status === 403) {
			throw new Error(
				"LinkedIn rejected the Pages lookup (403). The token is missing the 'r_organization_admin' scope " +
					"(needs the Community Management API product on your LinkedIn app).",
			);
		}
		throw new Error(`Failed to list LinkedIn organizations (${aclRes.status}): ${body.slice(0, 300)}`);
	}

	const aclData = await aclRes.json();
	const elements: any[] = aclData?.elements || [];
	const orgUrns = elements
		.map((e) => e.organizationalTarget || e.organization)
		.filter((u: any) => typeof u === "string");

	const results: Array<{ urn: string; organizationId: string; name: string }> = [];
	for (const urn of orgUrns) {
		const orgId = String(urn).split(":").pop() || "";
		let name = urn;
		try {
			const orgRes = await fetch(
				`https://api.linkedin.com/v2/organizations/${orgId}?projection=(id,localizedName,vanityName)`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"X-Restli-Protocol-Version": "2.0.0",
					},
				},
			);
			if (orgRes.ok) {
				const org = await orgRes.json();
				name = org.localizedName || org.vanityName || urn;
			}
		} catch {
			/* keep urn as the name */
		}
		results.push({ urn, organizationId: orgId, name });
	}
	return results;
}

/**
 * Create + publish a draft from raw content to a chosen account. Used by the
 * headless API endpoint. Persists a draft doc (so the web UI history stays
 * consistent), then publishes and writes the result back.
 */
export async function publishContent(
	uid: string,
	opts: {
		text: string;
		images?: string[];
		asPdf?: boolean;
		accountId?: string;
		visibility?: string;
		platform?: string;
	},
	publishToLinkedIn: (
		text: string,
		images: string[] | null,
		token: string,
		urn: string,
		asPdf?: boolean,
		visibility?: string,
	) => Promise<{ success: boolean; platform: string; id: string }>,
): Promise<any> {
	const platform = (opts.platform || "linkedin").toLowerCase();
	if (platform !== "linkedin") {
		throw new Error(`Unsupported platform "${platform}". Only "linkedin" is supported.`);
	}

	const text = String(opts.text || "").trim();
	if (!text) throw new Error("`text` is required and was empty.");

	const images = Array.isArray(opts.images) ? opts.images.filter((u) => typeof u === "string" && u) : [];
	const asPdf = !!opts.asPdf;
	const visibility = String(opts.visibility || "PUBLIC").toUpperCase();

	const db = admin.firestore();
	const account = await resolveAccount(db, uid, opts.accountId);

	const draftRef = await db.collection(`users/${uid}/drafts`).add({
		source: "api",
		linkedinPost: text,
		availableImages: images,
		linkedinImageIndices: images.map((_, i) => i).slice(0, 9),
		linkedinAsPdf: asPdf,
		targetAccountId: account.id,
		targetUrn: account.urn,
		targetDisplayName: account.displayName,
		status: "Draft",
		createdAt: admin.firestore.FieldValue.serverTimestamp(),
	});

	try {
		const result = await publishToLinkedIn(text, images, account.accessToken, account.urn, asPdf, visibility);
		await draftRef.update({
			status: "Published",
			linkedinPostId: result.id,
			publishedAt: admin.firestore.FieldValue.serverTimestamp(),
		});
		return {
			success: true,
			postId: result.id,
			permalink: `https://www.linkedin.com/feed/update/${encodeURIComponent(result.id)}/`,
			account: { id: account.id, displayName: account.displayName, urn: account.urn, type: account.type },
			draftId: draftRef.id,
		};
	} catch (error: any) {
		await draftRef.update({
			status: "Failed",
			"publishErrors.linkedin": error?.message || "Unknown error",
		});
		throw error;
	}
}
