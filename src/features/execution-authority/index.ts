import type {
  AuthorityGrant,
  AuthorityOwner,
  AuthorityReview,
  AuthorityReviewDecision,
  CreateAuthorityReview,
} from "./grants";

/** Host-owned boundary used by Chat and Task flows; the Webview never mints grants. */
export interface ExecutionAuthorityService {
  createAuthorityReview(input: CreateAuthorityReview, now?: string): AuthorityReview;
  getAuthorityReview(reviewId: string): AuthorityReview | undefined;
  resolveAuthorityReview(reviewId: string, decision: AuthorityReviewDecision, confirmationHash: string, expiresAt?: string | null, now?: string): AuthorityGrant | undefined;
  listAuthorityGrants(owner: AuthorityOwner): readonly AuthorityGrant[];
  consumeAuthorityGrant(grantId: string, now?: string): void;
  revokeAuthorityGrant(grantId: string, now?: string): void;
}

export * from "./grants";
export * from "./environment";
export * from "./operations";
export * from "./policy";
