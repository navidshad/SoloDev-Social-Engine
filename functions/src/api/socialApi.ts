import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
	resolveOwnerUserId,
	listSocialAccounts,
	publishContent,
} from "../services/accountsService";
import { publishToLinkedIn } from "../services/linkedinService";

/**
 * Headless publishing API — the door an external agent (e.g. Aso) knocks on.
 *
 * Auth: a single shared secret in `PUBLISH_API_KEY`, sent as either
 *   Authorization: Bearer <key>   or   x-api-key: <key>
 * This is server-to-server (no Firebase Auth / browser login), so it does NOT
 * need CORS. The owning user is resolved the same way the GitHub webhook does
 * it (solo app → first user doc).
 *
 * Routes (chosen by `action`):
 *   GET  ?action=accounts                      → list publishable accounts/pages
 *   POST { action:'publish', text, images?,    → create a draft + publish it
 *          asPdf?, accountId?, visibility? }
 */
export const socialApi = onRequest({ secrets: ["PUBLISH_API_KEY"] }, async (req, res) => {
	const expected = (process.env.PUBLISH_API_KEY || "").trim();
	if (!expected) {
		res.status(500).json({ success: false, error: "PUBLISH_API_KEY is not configured on the server." });
		return;
	}

	const authHeader = req.get("authorization") || "";
	const provided = (authHeader.replace(/^Bearer\s+/i, "").trim() || req.get("x-api-key") || "").trim();
	if (!provided || provided !== expected) {
		res.status(401).json({ success: false, error: "Unauthorized — missing or invalid API key." });
		return;
	}

	try {
		const db = admin.firestore();
		const uid = await resolveOwnerUserId(db);

		const action =
			(req.method === "GET" ? (req.query.action as string) : req.body?.action) ||
			(req.method === "GET" ? "accounts" : "publish");

		if (action === "accounts") {
			const accounts = await listSocialAccounts(db, uid);
			res.status(200).json({ success: true, accounts });
			return;
		}

		if (action === "publish") {
			if (req.method !== "POST") {
				res.status(405).json({ success: false, error: "publish requires POST." });
				return;
			}
			const { text, images, asPdf, accountId, visibility, platform } = req.body || {};
			if (!text || !String(text).trim()) {
				res.status(400).json({ success: false, error: "`text` is required." });
				return;
			}
			const result = await publishContent(
				uid,
				{ text, images, asPdf, accountId, visibility, platform },
				publishToLinkedIn,
			);
			res.status(200).json(result);
			return;
		}

		res.status(400).json({ success: false, error: `Unknown action "${action}". Use "accounts" or "publish".` });
	} catch (error: any) {
		console.error("socialApi error:", error);
		res.status(500).json({ success: false, error: error?.message || "Internal error." });
	}
});
