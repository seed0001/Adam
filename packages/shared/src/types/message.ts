import { z } from "zod";

export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSourceSchema = z.enum([
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "imessage",
  "teams",
  "cli",
  "internal",
]);
export type MessageSource = z.infer<typeof MessageSourceSchema>;

export const InboundMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string().uuid(),
  source: MessageSourceSchema,
  channelId: z.string(),
  userId: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  attachments: z
    .array(
      z.object({
        type: z.enum(["image", "audio", "file", "video"]),
        url: z.string().optional(),
        data: z.instanceof(Buffer).optional(),
        mimeType: z.string(),
        filename: z.string().optional(),
      }),
    )
    .default([]),
  receivedAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

export const OutboundMessageSchema = z.object({
  sessionId: z.string().uuid(),
  channelId: z.string(),
  source: MessageSourceSchema,
  content: z.string(),
  voiceProfileId: z.string().uuid().nullable().default(null),
  replyToId: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;
