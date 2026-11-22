# Security Specification — Water Billing Ledger (Firestore Rules)

## 1. Data Invariants

1. **Ownership Anchor (Master Gate)**:
   - Every user owns a non-PII root anchor document at `/users/{userId}` where `userId == request.auth.uid`.
   - Subcollections `/users/{userId}/settings/{settingId}` and `/users/{userId}/records/{recordId}` can only be accessed by their verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`), and writes/gets require the parent `/users/{userId}` document to exist (or be created atomically in the same batch via `existsAfter`).
2. **No PII Storage**:
   - No email addresses, phone numbers, or street addresses are stored in Firestore documents. Only water meter numbers, usage metrics, settlement sums, and the user-configured deposit account memo are stored strictly under the owner's private path.
3. **Strict Schema & Size Boundaries**:
   - Every document enforces exact key membership (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update).
   - Every string enforces explicit `.size()` and/or regex validation matching `firebase-blueprint.json`.
   - Every numeric field enforces realistic numeric bounds to prevent resource/data poisoning.
4. **Immutability & Server Timestamps**:
   - `ownerId` and `createdAt` are immutable after creation.
   - `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
5. **Query Security**:
   - `allow list` on `/users/{userId}/records/{recordId}` enforces `resource.data.ownerId == request.auth.uid` without calling `get()`/`exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Unauthenticated Read**: Read `/users/userA/records/2024-04` with `auth = null`.
2. **Unverified Email Write**: Create `/users/userA` with `auth.uid = 'userA'` and `auth.token.email_verified = false`.
3. **Cross-Tenant Read**: Read `/users/userA/records/2024-04` as `auth.uid = 'userB'`.
4. **Identity Spoofing on Create**: Create `/users/userA/records/2026-11` as `userA` with `ownerId: 'userB'`.
5. **Shadow / Ghost Field Injection**: Create `/users/userA/settings/main` with extra field `isAdmin: true`.
6. **Path ID Poisoning**: Create `/users/userA/records/invalid..id!@#` or a 200-char record ID.
7. **Orphaned Subcollection Write**: Create `/users/userA/records/2026-11` when `/users/userA` does not exist and is not created in the same batch.
8. **Immutable Field Mutation**: Update `/users/userA/records/2026-11` changing `ownerId` or `createdAt`.
9. **Client Timestamp Forgery**: Create `/users/userA/records/2026-11` with `createdAt` set to a client-chosen past timestamp (`!= request.time`).
10. **Value Poisoning (Oversized String)**: Update `/users/userA/settings/main` setting `accountInfo` to a 500-character string (`> 120`).
11. **Invalid Enum Injection**: Create `/users/userA/records/2026-11` with `adjustmentTarget: '999호'`.
12. **Blanket List Query Scraping**: List `/users/userA/records` as `userB` without matching `ownerId`.
