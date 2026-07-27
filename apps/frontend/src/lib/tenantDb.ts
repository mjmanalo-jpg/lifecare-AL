import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { TenantContext } from "./tenant";
import type { ModelDef } from "./models";

export async function withTenantDb<T>(context: TenantContext, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // The tenant GUCs only matter once a least-privilege, RLS-ENFORCING database
  // role is configured (a pending follow-up — see docs/SAAS-OPERATIONS.md). Until
  // then RLS is not enforced for the app's connection, and tenancy is guaranteed
  // by the application-level `tenantWhere` filters applied to every query.
  //
  // Wrapping each request in an interactive transaction purely to set those GUCs
  // costs ~3 extra serial network round-trips to a remote pooler on EVERY call —
  // the dominant source of the multi-second per-request latency. So we skip it by
  // default and run the operation directly (one round-trip). Flip DB_RLS_GUCS=true
  // once the enforcing role is live to restore the transaction-scoped GUCs.
  if (process.env.DB_RLS_GUCS !== "true") {
    return operation(prisma as unknown as Prisma.TransactionClient);
  }
  return prisma.$transaction(async (tx) => {
    // All four GUCs in ONE round-trip (four separate statements = three extra trips).
    await tx.$executeRaw`SELECT
      set_config('app.user_id', ${context.userId}, true),
      set_config('app.organization_id', ${context.organizationId || ""}, true),
      set_config('app.community_id', ${context.communityId || ""}, true),
      set_config('app.is_platform', ${context.isPlatform ? "true" : "false"}, true)`;
    return operation(tx);
  });
}

export function transactionDelegate(definition: ModelDef, tx: Prisma.TransactionClient) {
  const name = definition.table.charAt(0).toLowerCase() + definition.table.slice(1);
  return (tx as unknown as Record<string, ModelDef["delegate"]>)[name];
}