# Local Image Import Design

## Goal

Allow the loopback Push Import API to accept decoded image files by absolute local path, ingest them into ChatLab-managed storage, and render them in CLI Web chat records.

## Decisions

- `sourcePath` is a transport-only instruction. It is validated and copied into `<userDataDir>/media/<sessionId>/`; the absolute path is never stored in SQLite or returned to the browser.
- Messages carry an optional `attachments` array. The first supported kind is `image`; JPEG, PNG, GIF, and WebP are accepted.
- Attachment rows reference messages by internal ID. Import attachment lookup requires `platformMessageId`, which the WeChat bridge already provides.
- Media files use a SHA-256 content-addressed filename. ChatLab first attempts copy-on-write cloning and falls back to a normal copy.
- CLI Web serves managed files through a session-scoped HTTP route. The browser never receives a `file://` URL.
- Deleting a session also removes its managed media directory.

## WeChat resolution

The bridge resolves each image from `(chat username, local_id, timestamp)`. It reads the image MD5 from the message row's `packed_info_data`, locates the matching `.dat`, decrypts it into the existing decoded-image cache, and sends the resulting absolute path in the Push payload. This avoids relying on the currently stale `message_resource.db` cache.

## Failure behavior

- Dry-run validates attachment paths and formats without copying.
- A missing, unreadable, oversized, or unsupported image rejects the batch before message writes.
- A failed new-session import removes its database and newly managed session media.
- Repeated content is idempotent because the managed filename is content-addressed and attachment rows are unique per message and hash.

## Verification

Unit tests cover payload validation, managed ingestion, database linkage, media HTTP serving, deletion cleanup, WeChat image-path mapping, and batching. A live smoke test imports a small sample before the full one-month re-import.
