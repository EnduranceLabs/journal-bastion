export {
  BASTION_ERROR_CODES,
  BastionErrorCodeSchema,
  BastionErrorSchema,
  type BastionError,
  type BastionErrorCode,
} from "./errors.js";

export { SkillSchema, type Skill } from "./skills.js";

export {
  ToolDefinitionSchema,
  IntegrationSchema,
  TextContentSchema,
  ImageContentSchema,
  ContentBlockSchema,
  ToolResultSchema,
  type ToolDefinition,
  type Integration,
  type TextContent,
  type ImageContent,
  type ContentBlock,
  type ToolResult,
} from "./integrations.js";

export {
  AuthenticateMessageSchema,
  ToolResultMessageSchema,
  ToolErrorMessageSchema,
  PongMessageSchema,
  VersionChangedMessageSchema,
  VersionsMessageSchema,
  ToolsMessageSchema,
  SkillsMessageSchema,
  BastionMessageSchema,
  AuthenticatedMessageSchema,
  AuthErrorMessageSchema,
  ToolCallMessageSchema,
  PingMessageSchema,
  GetVersionsMessageSchema,
  GetToolsMessageSchema,
  GetSkillsMessageSchema,
  ServiceMessageSchema,
  type AuthenticateMessage,
  type ToolResultMessage,
  type ToolErrorMessage,
  type PongMessage,
  type VersionChangedMessage,
  type VersionsMessage,
  type ToolsMessage,
  type SkillsMessage,
  type BastionMessage,
  type AuthenticatedMessage,
  type AuthErrorMessage,
  type ToolCallMessage,
  type PingMessage,
  type GetVersionsMessage,
  type GetToolsMessage,
  type GetSkillsMessage,
  type ServiceMessage,
} from "./messages.js";

export type { IntegrationProvider, BastionConfig, BastionVersions } from "./provider.js";
export { IntegrationNotFoundError } from "./provider.js";
