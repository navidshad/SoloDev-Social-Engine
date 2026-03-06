import * as admin from "firebase-admin";

admin.initializeApp();

export * from "./webhooks/githubRelease";
export * from "./api/publishDraft";
export * from "./api/generateInitialPost";
