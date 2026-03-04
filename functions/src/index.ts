import * as admin from "firebase-admin";

admin.initializeApp();

export * from "./webhooks/githubRelease";
