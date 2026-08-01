// Provider-agnostic online payment layer (server-only).

export type CheckoutResult = {
  ok: boolean;
  provider: string;
  checkoutUrl?: string;
  referenceId?: string;
  error?: string;
  simulated?: boolean;
};

export type CreateCheckoutParams = {
  amount: number;
  currency?: string;
  description?: string;
  referenceId?: string;
};

/**
 * Provider-agnostic online payment layer.
 *
 * Activation is entirely env-driven:
 *   PAYMENT_PROVIDER = "paymongo" | "stripe" | "" (unset)
 *   PAYMONGO_SECRET_KEY   (required for paymongo)
 *   STRIPE_SECRET_KEY     (required for stripe)
 *   APP_BASE_URL          (redirect base; defaults to http://localhost:3001)
 *
 * When no provider is configured (or its key is missing) this degrades
 * gracefully to a simulated checkout so the app keeps working in demo mode.
 * This function NEVER throws — it always resolves to a CheckoutResult.
 * Secrets are never logged.
 */
export async function createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
  const amount = params.amount;
  const currency = params.currency || "PHP";
  const description = params.description || "SLMS Billing";
  const referenceId = params.referenceId;

  const provider = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();

  try {
    if (provider === "paymongo") {
      const secret = process.env.PAYMONGO_SECRET_KEY;
      if (!secret) return simulated(amount, referenceId);
      return await createPayMongoCheckout({ amount, currency, description, referenceId, secret });
    }

    if (provider === "stripe") {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) return simulated(amount, referenceId);
      return await createStripeCheckout({ amount, currency, description, referenceId, secret });
    }

    // No provider configured.
    return simulated(amount, referenceId);
  } catch (error) {
    // Never throw — surface a graceful error result instead.
    return {
      ok: false,
      provider: provider || "unknown",
      error: error instanceof Error ? error.message : "Checkout failed",
    };
  }
}

function simulated(amount: number, referenceId?: string): CheckoutResult {
  console.info(`[payments] not configured — simulated checkout for ${amount}`);
  return {
    ok: true,
    provider: "simulated",
    simulated: true,
    referenceId: `SIM-${referenceId || "TXN"}`,
  };
}

async function createPayMongoCheckout(args: {
  amount: number;
  currency: string;
  description: string;
  referenceId?: string;
  secret: string;
}): Promise<CheckoutResult> {
  const { amount, currency, description, referenceId, secret } = args;
  const basic = Buffer.from(`${secret}:`).toString("base64");

  const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              name: description || "SLMS Billing",
              amount: Math.round(amount * 100),
              currency: currency || "PHP",
              quantity: 1,
            },
          ],
          payment_method_types: ["gcash", "card"],
          description,
        },
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: { id?: string; attributes?: { checkout_url?: string } }; errors?: Array<{ detail?: string }> }
    | null;

  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail;
    return {
      ok: false,
      provider: "paymongo",
      error: detail || `PayMongo checkout failed (${response.status})`,
    };
  }

  return {
    ok: true,
    provider: "paymongo",
    checkoutUrl: payload?.data?.attributes?.checkout_url,
    referenceId: payload?.data?.id || referenceId,
  };
}

async function createStripeCheckout(args: {
  amount: number;
  currency: string;
  description: string;
  referenceId?: string;
  secret: string;
}): Promise<CheckoutResult> {
  const { amount, currency, description, referenceId, secret } = args;
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3001";

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${baseUrl}/family/billing?checkout=success`);
  form.set("cancel_url", `${baseUrl}/family/billing?checkout=cancel`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", (currency || "PHP").toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
  form.set("line_items[0][price_data][product_data][name]", description || "SLMS Billing");
  if (referenceId) form.set("client_reference_id", referenceId);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; url?: string; error?: { message?: string } }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      provider: "stripe",
      error: payload?.error?.message || `Stripe checkout failed (${response.status})`,
    };
  }

  return {
    ok: true,
    provider: "stripe",
    checkoutUrl: payload?.url,
    referenceId: payload?.id || referenceId,
  };
}
