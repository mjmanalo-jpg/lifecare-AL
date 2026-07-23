import { getSupabaseTokens } from "./auth";
import { requireTenantContext } from "./tenant";

export async function backendAuthHeaders(): Promise<Record<string, string> | null> {
  const context = await requireTenantContext({ requireCommunity: true });
  const { accessToken } = await getSupabaseTokens();
  if (!context?.organizationId || !context.communityId || !accessToken) return null;
  return { Authorization: `Bearer ${accessToken}`, "X-Organization-Id": context.organizationId, "X-Community-Id": context.communityId };
}