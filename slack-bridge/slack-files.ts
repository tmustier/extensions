import path from "node:path";

export interface SlackMessageFile {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  prettyType?: string;
  permalink?: string;
  urlPrivate?: string;
  preview?: string;
  size?: number;
}

export const SLACK_ATTACHMENT_INLINE_TEXT_MAX_BYTES = 64 * 1024;
export const SLACK_ATTACHMENT_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

const SLACK_ATTACHMENT_INLINE_TEXT_FILETYPES = new Set([
  "c",
  "cpp",
  "css",
  "csv",
  "diff",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "markdown",
  "md",
  "patch",
  "py",
  "rb",
  "sh",
  "sql",
  "svg",
  "text",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

function asNonEmptySlackString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asSlackFileRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSlackPreview(preview: string | undefined): string | undefined {
  if (!preview) return undefined;
  const normalized = preview.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= 200) return normalized;
  return `${normalized.slice(0, 197).trimEnd()}...`;
}

export function normalizeSlackMessageFiles(files: unknown): SlackMessageFile[] {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .map((file) => {
      const record = asSlackFileRecord(file);
      if (!record) {
        return null;
      }

      const normalized: SlackMessageFile = {
        id: asNonEmptySlackString(record.id),
        name: asNonEmptySlackString(record.name),
        title: asNonEmptySlackString(record.title),
        mimetype: asNonEmptySlackString(record.mimetype),
        filetype: asNonEmptySlackString(record.filetype),
        prettyType:
          asNonEmptySlackString(record.pretty_type) ?? asNonEmptySlackString(record.prettyType),
        permalink: asNonEmptySlackString(record.permalink),
        urlPrivate:
          asNonEmptySlackString(record.url_private_download) ??
          asNonEmptySlackString(record.urlPrivate) ??
          asNonEmptySlackString(record.url_private),
        preview: normalizeSlackPreview(asNonEmptySlackString(record.preview)),
        size:
          typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
            ? record.size
            : undefined,
      };

      if (!normalized.id && !normalized.name && !normalized.title && !normalized.permalink) {
        return null;
      }

      return normalized;
    })
    .filter((file): file is SlackMessageFile => file !== null);
}

export function formatSlackAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return "unknown size";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    const value = size / 1024;
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    const value = size / (1024 * 1024);
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MB`;
  }
  const value = size / (1024 * 1024 * 1024);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} GB`;
}

function getSlackAttachmentLabel(file: SlackMessageFile): string {
  return file.name ?? file.title ?? file.id ?? "attachment";
}

function getSlackAttachmentType(file: SlackMessageFile): string | undefined {
  return file.prettyType ?? file.mimetype ?? file.filetype;
}

export function summarizeSlackAttachmentLabels(files: SlackMessageFile[]): string {
  const labels = files.map((file) => getSlackAttachmentLabel(file)).filter(Boolean);
  return labels.length > 0 ? labels.slice(0, 2).join(", ") : "";
}

export function buildSlackAttachmentContextLines(files: unknown): string[] {
  return normalizeSlackMessageFiles(files)
    .slice(0, 4)
    .map((file) => {
      const details = [
        getSlackAttachmentLabel(file),
        getSlackAttachmentType(file),
        typeof file.size === "number" ? formatSlackAttachmentSize(file.size) : undefined,
        file.id ? `file_id=${file.id}` : undefined,
      ].filter((value): value is string => Boolean(value));
      return details.join(" — ");
    })
    .filter((line) => line.length > 0);
}

export function buildSlackAttachmentSummaryLines(files: SlackMessageFile[]): string[] {
  if (files.length === 0) {
    return [];
  }

  const lines = ["Attachments:"];
  files.forEach((file, index) => {
    const details = [
      getSlackAttachmentType(file),
      typeof file.size === "number" ? formatSlackAttachmentSize(file.size) : undefined,
      file.id ? `file_id=${file.id}` : undefined,
    ].filter((value): value is string => Boolean(value));

    lines.push(
      `- [${index}] ${getSlackAttachmentLabel(file)}${details.length > 0 ? ` (${details.join(", ")})` : ""}`,
    );

    if (file.permalink) {
      lines.push(`  Permalink: ${file.permalink}`);
    }
    if (file.preview) {
      lines.push(`  Preview: ${file.preview}`);
    }
  });

  return lines;
}

export function formatSlackReadableMessage(
  message: { ts?: string; text?: string; files?: unknown },
  authorName: string,
): string {
  const ts = typeof message.ts === "string" && message.ts.length > 0 ? message.ts : "unknown-ts";
  const text =
    typeof message.text === "string" && message.text.length > 0 ? message.text : "(no text)";
  const lines = [`[${ts}] ${authorName}: ${text}`];
  lines.push(...buildSlackAttachmentSummaryLines(normalizeSlackMessageFiles(message.files)));
  return lines.join("\n");
}

export function isInlineTextSlackAttachment(file: SlackMessageFile): boolean {
  const mimetype = file.mimetype?.trim().toLowerCase();
  if (mimetype?.startsWith("text/")) {
    return true;
  }

  if (
    mimetype === "application/json" ||
    mimetype === "application/ld+json" ||
    mimetype === "application/xml" ||
    mimetype === "image/svg+xml"
  ) {
    return true;
  }

  const filetype = file.filetype?.trim().toLowerCase();
  return filetype ? SLACK_ATTACHMENT_INLINE_TEXT_FILETYPES.has(filetype) : false;
}

export function sanitizeSlackAttachmentFilename(fileId: string, file: SlackMessageFile): string {
  const candidate = (file.name ?? file.title ?? "").trim();
  const normalizedCandidate = candidate.length > 0 ? candidate : fileId;
  const withoutControlChars = [...path.basename(normalizedCandidate)]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 ? character : "-";
    })
    .join("");
  const basename = withoutControlChars.replace(/[<>:"/\\|?*]/g, "-");
  const collapsed = basename.replace(/\s+/g, " ").trim();
  if (collapsed.length > 0) {
    return collapsed;
  }

  const filetype = file.filetype?.trim().toLowerCase();
  return filetype ? `${fileId}.${filetype}` : `${fileId}.bin`;
}
