import { z } from "zod";

export const boqSchema = z.object({
  projectId: z.string().min(1, "Project is required."),
  name: z.string().trim().min(1, "BOQ name is required.").max(200),
  description: z.string().trim().max(5000).optional().default(""),
  revision: z.coerce.number().int().min(0).max(9999).default(0),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a three-letter code.")
    .optional(),
});

export const boqItemSchema = z.object({
  itemNumber: z.string().trim().max(100).optional().default(""),
  description: z.string().trim().min(1, "Description is required.").max(5000),
  quantity: z.coerce
    .number()
    .positive("Quantity must be greater than zero.")
    .max(999999999),
  unit: z.string().trim().max(30).optional().default("EA"),
  manufacturer: z.string().trim().max(200).optional().default(""),
  model: z.string().trim().max(200).optional().default(""),
  remarks: z.string().trim().max(2000).optional().default(""),
});
