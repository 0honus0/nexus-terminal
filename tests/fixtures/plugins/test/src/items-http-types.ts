import { z } from 'zod';

export const ListItemsInputSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export type ListItemsInput = z.infer<typeof ListItemsInputSchema>;

export const ListItemsOutputSchema = z.object({ items: z.array(z.object({ id: z.string(), label: z.string() })) });

export type ListItemsOutput = z.infer<typeof ListItemsOutputSchema>;
