import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const MAX_IMAGE_BYTES = 50 * 1024 * 1024

export interface LocalImageImportInstruction {
  kind: 'image'
  sourcePath: string
}

export interface LocalMediaImportMessage {
  platformMessageId?: string
  attachments?: LocalImageImportInstruction[]
}

export interface PreparedLocalMediaAttachment {
  platformMessageId: string
  kind: 'image'
  storagePath: string
  mimeType: string
  sha256: string
  byteSize: number
}

export interface PreparedLocalMediaBatch {
  attachments: PreparedLocalMediaAttachment[]
  createdPaths: string[]
}

interface DetectedImage {
  extension: 'jpg' | 'png' | 'gif' | 'webp'
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

function detectImage(header: Buffer): DetectedImage | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' }
  }
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', mimeType: 'image/png' }
  }
  if (header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { extension: 'gif', mimeType: 'image/gif' }
  }
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: 'webp', mimeType: 'image/webp' }
  }
  return null
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function inspectImage(
  sourcePath: string,
  field: string
): Promise<{
  realPath: string
  image: DetectedImage
  byteSize: number
  sha256: string
}> {
  if (!path.isAbsolute(sourcePath)) throw new Error(`${field}.sourcePath must be an absolute path`)

  let realPath: string
  let stat
  try {
    realPath = await fs.realpath(sourcePath)
    stat = await fs.stat(realPath)
  } catch {
    throw new Error(`${field}.sourcePath is not readable`)
  }
  if (!stat.isFile()) throw new Error(`${field}.sourcePath must reference a regular file`)
  if (stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`${field}.sourcePath must be between 1 byte and ${MAX_IMAGE_BYTES} bytes`)
  }

  const handle = await fs.open(realPath, 'r')
  let header: Buffer
  try {
    header = Buffer.alloc(12)
    const result = await handle.read(header, 0, header.length, 0)
    header = header.subarray(0, result.bytesRead)
  } finally {
    await handle.close()
  }
  const image = detectImage(header)
  if (!image) throw new Error(`${field}.sourcePath is not a supported JPEG, PNG, GIF, or WebP image`)

  return { realPath, image, byteSize: stat.size, sha256: await sha256File(realPath) }
}

async function cloneOrCopy(sourcePath: string, destinationPath: string): Promise<boolean> {
  try {
    await fs.access(destinationPath)
    return false
  } catch {
    // Missing destination is the expected path.
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.copyFile(sourcePath, tempPath, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL)
    try {
      await fs.rename(tempPath, destinationPath)
      return true
    } catch (error) {
      try {
        await fs.access(destinationPath)
        await fs.unlink(tempPath)
        return false
      } catch {
        throw error
      }
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}

export async function prepareLocalMediaImports(
  mediaRoot: string,
  sessionId: string,
  messages: readonly LocalMediaImportMessage[],
  options: { copy: boolean }
): Promise<PreparedLocalMediaBatch> {
  const attachments: PreparedLocalMediaAttachment[] = []
  const createdPaths: string[] = []

  try {
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const message = messages[messageIndex]!
      if (!message.attachments?.length) continue
      if (!message.platformMessageId) {
        throw new Error(`messages[${messageIndex}].platformMessageId is required when attachments are present`)
      }

      for (let attachmentIndex = 0; attachmentIndex < message.attachments.length; attachmentIndex++) {
        const instruction = message.attachments[attachmentIndex]!
        const field = `messages[${messageIndex}].attachments[${attachmentIndex}]`
        if (instruction.kind !== 'image') throw new Error(`${field}.kind must be 'image'`)
        if (typeof instruction.sourcePath !== 'string' || !instruction.sourcePath) {
          throw new Error(`${field}.sourcePath must be a non-empty string`)
        }

        const inspected = await inspectImage(instruction.sourcePath, field)
        const storagePath = path.posix.join(sessionId, `${inspected.sha256}.${inspected.image.extension}`)
        const destinationPath = path.join(mediaRoot, sessionId, `${inspected.sha256}.${inspected.image.extension}`)
        if (options.copy && (await cloneOrCopy(inspected.realPath, destinationPath))) createdPaths.push(destinationPath)
        attachments.push({
          platformMessageId: message.platformMessageId,
          kind: 'image',
          storagePath,
          mimeType: inspected.image.mimeType,
          sha256: inspected.sha256,
          byteSize: inspected.byteSize,
        })
      }
    }
    return { attachments, createdPaths }
  } catch (error) {
    await cleanupPreparedLocalMedia(createdPaths)
    throw error
  }
}

export async function cleanupPreparedLocalMedia(createdPaths: readonly string[]): Promise<void> {
  await Promise.all(createdPaths.map((filePath) => fs.rm(filePath, { force: true })))
}
