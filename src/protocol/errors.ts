import { z } from "zod";

export const BASTION_ERROR_CODES = [
  "INTEGRATION_NOT_FOUND",
  "EXECUTION_FAILED",
  "TIMEOUT",
] as const;

export type BastionErrorCode = (typeof BASTION_ERROR_CODES)[number];

export const BastionErrorCodeSchema = z.enum(BASTION_ERROR_CODES);

export const BastionErrorSchema = z.object({
  code: BastionErrorCodeSchema,
  message: z.string(),
});

export type BastionError = z.infer<typeof BastionErrorSchema>;
