import { z } from "zod";

export const publicMcpPermissionSchema = z.strictObject({
  workspaceRead: z.boolean().optional(),
  workspaceWrite: z.boolean().optional(),
  workspaceDelete: z.boolean().optional(),
  mediaGeneration: z.boolean().optional(),
  appManagement: z.boolean().optional(),
  agentExecution: z.boolean().optional(),
  pluginExecution: z.boolean().optional(),
});

export type PublicMcpPermissions = z.infer<typeof publicMcpPermissionSchema>;
