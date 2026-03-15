import * as admin from "firebase-admin";

admin.initializeApp();

import { handleGithubRelease } from "./webhooks/githubRelease";
import { publishDraft } from "./api/publishDraft";
import { generateInitialPost } from "./api/generateInitialPost";
import { refineDraft } from "./api/refineDraft";
import { toggleRepoWebhook } from "./api/toggleRepoWebhook";
import { testXCredentials } from "./api/testXCredentials";
import { testLinkedInCredentials } from "./api/testLinkedInCredentials";
import { regenerateDraft } from "./api/regenerateDraft";

export { handleGithubRelease, publishDraft, generateInitialPost, refineDraft, toggleRepoWebhook, testXCredentials, testLinkedInCredentials, regenerateDraft };
