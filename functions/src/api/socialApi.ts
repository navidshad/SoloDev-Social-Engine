import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
	resolveOwnerUserId,
	listSocialAccounts,
	publishContent,
} from "../services/accountsService";
import { validateApiKey } from "../services/apiKeysService";
import { publishToLinkedIn } from "../services/linkedinService";

/**
 * Headless publishing API — the door an external agent (e.g. Aso) knocks on.
 *
 * Auth: an API key generated and revoked by the owner from the app dashboard
 * (Settings → Headless API), sent as either
 *   Authorization: Bearer <key>   or   x-api-key: <key>
 * Only the key's hash is stored, and the presented key is validated by an
 * indexed hash lookup (no timing side-channel). This is server-to-server (no
 * Firebase Auth / browser login), so it does NOT need CORS. The owning user is
 * resolved the same way the GitHub webhook does it (solo app → first user doc).
 *
 * Routes (chosen by `action`):
 *   GET  ?action=accounts                          → list publishable accounts/pages
 *   POST { action:'publish', text, images?, asPdf?, → create a draft + publish it
 *          pdfUrl?, accountId?, visibility? }
 *
 * `pdfUrl` posts a ready-made PDF as a document (uploaded as-is). `asPdf:true` with
 * `images` builds a PDF carousel from the images instead.
 */
export const socialApi = onRequest(async (req, res) => {
	const authHeader = req.get("authorization") || "";
	const provided = (authHeader.replace(/^Bearer\s+/i, "").trim() || req.get("x-api-key") || "").trim();
	if (!provided) {
		res.status(401).json({ success: false, error: "Unauthorized — missing API key." });
		return;
	}

	try {
		const db = admin.firestore();
		const uid = await resolveOwnerUserId(db);

		if (!(await validateApiKey(db, uid, provided))) {
			res.status(401).json({ success: false, error: "Unauthorized — invalid or revoked API key." });
			return;
		}

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
			const { text, images, asPdf, pdfUrl, accountId, visibility, platform } = req.body || {};
			if (!text || !String(text).trim()) {
				res.status(400).json({ success: false, error: "`text` is required." });
				return;
			}
			const result = await publishContent(
				uid,
				{ text, images, asPdf, pdfUrl, accountId, visibility, platform },
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
