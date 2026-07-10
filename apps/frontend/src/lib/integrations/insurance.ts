/**
 * Insurance verification — integration seam (Hybrid depth).
 *
 * Modules call `insuranceProvider.verify(...)` and never a vendor SDK. The MVP
 * ships a self-contained stub that "verifies" any well-formed policy; a real
 * clearinghouse/eligibility API (e.g. Availity, Change Healthcare) can be dropped
 * in later as a second implementation without touching the admission workflow.
 */

export interface InsuranceVerifyInput {
  provider: string;
  policyNumber: string;
  firstName?: string;
  lastName?: string;
}

export interface InsuranceVerifyResult {
  verified: boolean;
  message: string;
  verifiedAt: string; // ISO
  reference?: string;
}

export interface InsuranceProvider {
  verify(input: InsuranceVerifyInput): Promise<InsuranceVerifyResult>;
}

/** Self-contained stub: accepts any provider + a policy number of ≥ 4 chars. */
export const stubInsuranceProvider: InsuranceProvider = {
  async verify({ provider, policyNumber }) {
    const now = new Date().toISOString();
    const ok = Boolean(provider?.trim()) && policyNumber.replace(/\s/g, "").length >= 4;
    return {
      verified: ok,
      verifiedAt: now,
      message: ok
        ? `Coverage confirmed with ${provider}.`
        : "Could not verify — check the provider name and policy number.",
      reference: ok ? `VR-${policyNumber.slice(-4).toUpperCase()}` : undefined,
    };
  },
};

/** The active provider. Swap this binding to go live. */
export const insuranceProvider: InsuranceProvider = stubInsuranceProvider;
