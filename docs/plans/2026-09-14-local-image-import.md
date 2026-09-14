# Local Image Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import decoded WeChat images through ChatLab's local Push API and render them in CLI Web chat records.

**Architecture:** The bridge resolves and decrypts image files locally, then sends absolute `sourcePath` values. ChatLab validates and ingests those files into content-addressed session media storage, stores attachment metadata in SQLite, and serves them through a managed HTTP route.

**Tech Stack:** Python 3 standard library, TypeScript, Node.js fs/crypto, SQLite, Fastify, Vue 3.

---

### Task 1: Add attachment storage and query shape

**Files:**
- Modify: `packages/core/src/schema/tables.ts`
- Modify: `packages/node-runtime/src/migrations/chat-db-migrations.ts`
- Modify: `packages/core/src/query/message-sql.ts`
- Test: `packages/core/src/query/__tests__/message-query-functions.test.ts`

1. Add a `message_attachment` table and indexes, then bump the schema version.
2. Add an additive migration for existing session databases.
3. Include the first image attachment ID in mapped message query results.
4. Run the focused core query tests.

### Task 2: Ingest local image paths during Push Import

**Files:**
- Create: `packages/node-runtime/src/services/local-media-import.ts`
- Modify: `packages/node-runtime/src/services/push-importer.ts`
- Modify: `packages/node-runtime/src/database-manager.ts`
- Modify: `apps/desktop/main/worker/import/pushImport.ts`
- Test: `packages/node-runtime/src/services/push-importer.test.ts`

1. Add failing tests for accepted images, invalid paths/formats, dry-run, and session cleanup.
2. Validate regular absolute files and image magic bytes.
3. Hash and clone/copy images into the session media directory.
4. Write attachment rows after their messages and return attachment counts.
5. Remove managed media when a session is deleted or a new import fails.
6. Run the focused runtime tests.

### Task 3: Serve and render imported images

**Files:**
- Modify: `packages/http-routes/src/routes/web/sessions.ts`
- Modify: `packages/http-routes/src/routes/web/sessions.test.ts`
- Modify: `src/types/format.ts`
- Modify: `src/components/common/ChatRecord/MessageList.vue`
- Modify: `src/components/common/ChatRecord/MessageItem.vue`

1. Add a session-scoped managed-media GET route.
2. Verify the route rejects missing attachments and never escapes the media root.
3. Pass the active session ID to message items and render image attachments.
4. Run route tests, web type checking, lint, and formatting.

### Task 4: Resolve WeChat images into Push payloads

**Files:**
- Create: `/Users/li/Documents/GitHub/wechat-decrypt/integrations/chatlab/images.py`
- Modify: `/Users/li/Documents/GitHub/wechat-decrypt/integrations/chatlab/mapper.py`
- Modify: `/Users/li/Documents/GitHub/wechat-decrypt/integrations/chatlab/sync.py`
- Modify: `/Users/li/Documents/GitHub/wechat-decrypt/tests/test_chatlab_bridge.py`
- Modify: `/Users/li/Documents/GitHub/wechat-decrypt/docs/chatlab_sync.md`

1. Add failing tests for packed-info MD5 resolution, decoded-cache reuse, image mapping, and attachment-preserving batches.
2. Resolve the exact message row using local ID and timestamp.
3. Decrypt the best available `.dat` candidate and return a browser-compatible absolute path.
4. Attach resolved paths before mapping and quarantine image-resolution failures without exposing message content.
5. Run the bridge test suite.

### Task 5: Live sample and one-month re-import

1. Run ChatLab Node/web type checks and all focused tests.
2. Start CLI Web on loopback.
3. Delete the previous target session and its media through ChatLab.
4. Export and import a small recent sample, then verify SQLite attachment counts and HTTP image responses.
5. Re-run the one-month import for `53771146193@chatroom`.
6. Verify message/image counts and inspect rendered chat records in CLI Web.
7. Run `git diff --check` in both repositories and report separate worktree status.
