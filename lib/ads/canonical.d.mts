export declare const AD_REVIEW_DOMAIN: "layers-ad-review/1";
export declare function stableStringify(value: unknown): string;
export declare function lotTermsOf<T extends object>(lot: T): Omit<T, "review">;
export declare function lotTermsString(lot: object): string;
export declare function reviewCanonical(policy: string, lotId: string, termsHash: string, decision: string, reviewedAt: string): string;
