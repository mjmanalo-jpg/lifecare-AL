import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { TenantContext } from "./tenant";
import type { ModelDef } from "./models";

export async function withTenantDb<T>(context: TenantContext, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${context.userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${context.organizationId || ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.community_id', ${context.communityId || ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform', ${context.isPlatform ? "true" : "false"}, true)`;
    return operation(tx);
  });
}

export function transactionDelegate(definition: ModelDef, tx: Prisma.TransactionClient) {
  const name = definition.table.charAt(0).toLowerCase() + definition.table.slice(1);
  return (tx as unknown as Record<string, ModelDef["delegate"]>)[name];
}