import * as admin from "firebase-admin";

admin.initializeApp();

import { handleGithubRelease } from "./webhooks/githubRelease";
import { publishDraft } from "./api/publishDraft";
import { generateInitialPost } from "./api/generateInitialPost";
import { refineDraft } from "./api/refineDraft";

export { handleGithubRelease, publishDraft, generateInitialPost, refineDraft };
