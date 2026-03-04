# Product Requirements Document: SoloDev Social Engine

## 1. Product Overview

- **Name:** SoloDev Social Engine (Internal Code Name)
- **Objective:** To build a serverless, AI-powered hub that automatically translates technical GitHub releases into authentic, brand-building social media content for X and LinkedIn.
- **Goal:** To eliminate the context-switching tax of content creation, allowing the solo founder to maintain a consistent, engaging public presence and build a personal brand without taking time away from coding.

---

## 2. Target Persona & Use Case

- **User:** A solo entrepreneur and open-source project maintainer.
- **Core Problem:** Writing code and writing engaging social media copy require two entirely different mental states. After exhausting mental energy on a release, the founder often neglects promoting it or posts a dry, unengaging link.
- **The Solution:** A system that catches the technical release, applies the founder's specific "voice," and prepares highly engaging drafts that just need a quick review before publishing.

---

## 3. Core Features & Capabilities

### 3.1. The "Brand Control" Dashboard (Frontend)
A private, authenticated web interface built on `Firebase Hosting`.

#### API & Integration Settings
Inputs for **X API Keys**, **LinkedIn OAuth tokens**, and **GitHub Webhook Secret**.

#### Persona & Voice Configuration (Crucial Feature)
A text area where the founder defines their voice.
> **Example:** "I write in a 'build in public' style. I am humble but authoritative. I rarely use hashtags on X. I like to focus on the 'why' behind the code. Use a conversational tone."

This configuration is injected into the AI prompt for every generation.

#### Automation Toggles
- **Auto-Post Switch:** Global override.
  - **OFF:** All generations go to Drafts.
  - **ON:** Generations skip review and go live instantly.

### 3.2. Draft & Review Workflow
- **The Inbox:** A queue of AI-generated announcements triggered by recent GitHub releases.
- **Side-by-Side Editor:**
  - View the raw **GitHub Release Notes** on the left.
  - Edit the **X Post** and **LinkedIn Post** on the right.
- **Image Management:** View the screenshot/image extracted from the GitHub release. Option to upload a replacement image if the extracted one isn't ideal for social media.
- **Action Buttons:** `Publish Now`, `Save Changes`, `Discard`.

### 3.3. AI Content Generation Engine (Backend)
Triggered by `Firebase Cloud Functions` via GitHub Webhooks.

- **Context Ingestion:** Reads the repository name, version tag, and the raw markdown of the release notes.
- **Image Extraction:** Parses the markdown for `![alt](url)` to find attached UI screenshots or diagrams.
- **Platform-Specific Prompting (Using Gemini):**
  - **X (Twitter):** Instructed to write a "hook" first sentence, keep it under 280 characters, and focus on the immediate value or the "indie hacker" milestone.
  - **LinkedIn:** Instructed to write a storytelling post (up to 3,000 characters). It should expand on the problem this release solves, the technical learnings, and invite community discussion.
- **Voice Injection:** Both prompts append the user's custom "Persona & Voice Configuration" from the database.

### 3.4. Publishing & History
- **API Execution:** `Firebase Cloud Functions` handle the multi-step process of uploading media to X/LinkedIn and attaching the media IDs to the text posts.
- **Sent Log:** A historical record of everything published through the engine, including links to the live social posts for engagement tracking.

---

## 4. System Architecture (The Solo Dev Stack)

This stack is chosen specifically for a solo developer because it is virtually zero-maintenance and will likely operate entirely within Google Cloud/Firebase's free tiers.

- **Frontend UI:** `TS-Vue (Vite) + Tailwind CSS` — Fast to build, easy to make look clean and professional.
- **Hosting:** `Firebase Hosting` — Free tier is generous; deploys with a single CLI command.
- **Backend Orchestration:** `Firebase Cloud Functions (Node.js)` — Serverless. No VPS to patch. Scales to zero.
- **Database:** `Cloud Firestore` — Real-time syncing for the Drafts dashboard.
- **Authentication:** `Firebase Auth (GitHub Provider)` — Secure login; perfectly fits the developer workflow.
- **AI Integration:** `Google Gemini API` — Excellent at parsing markdown and adopting specific writing styles.

---

## 5. Development Principles & Coding Standards

Because this tool is built by a solo developer for a solo developer, the codebase must prioritize long-term maintainability over clever shortcuts.

- **High Modularity:** The architecture must be highly decoupled. Integrations for distinct services (e.g., `xService.js`, `linkedinService.js`, `geminiService.js`, `githubParser.js`) should act as independent modules.
- **Human-Readable Code:** The source code must prioritize human readability. The code should feature descriptive, self-documenting variable and function names (e.g., `generateLinkedInDraftFromRelease` rather than `genLI`), avoiding overly dense one-liners in favor of clear, step-by-step logic and thorough inline comments.

---

## 6. Typical User Journey (The "Build in Public" Flow)

1. **The Work:** The solo dev finishes a major feature and publishes a Release on GitHub, dropping a quick screenshot into the release notes.
2. **The Automation:** Behind the scenes, the Webhook fires. The Cloud Function downloads the screenshot, reads the dev's "Voice Profile" from Firestore, and asks Gemini to write the posts.
3. **The Notification:** The dev gets an email/ping (optional feature) saying "New social drafts are ready."
4. **The Review:** The dev opens the SoloDev Social Engine dashboard. They read the LinkedIn draft, add a quick personal sentence about how hard the bug was to fix, and click "Approve."
5. **The Result:** The update is live across platforms in their authentic voice, maintaining their public presence while they go grab a coffee.