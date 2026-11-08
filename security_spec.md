# Security Specification: InterviewCoach SA Firestore Architecture

## 1. Data Invariants
1. **User Identity Boundary**: Every document under `/users/{userId}` and its subcollections (`private`, `practice_answers`, `mock_sessions`) strictly belongs to the authenticated user matching `request.auth.uid`. No user can read or mutate another candidate's profile, answers, or mock session results.
2. **Path Variable Hardening**: Document IDs and path variables (`userId`, `answerId`, `sessionId`, `questionId`) must satisfy `isValidId()` (string, length <= 128, pattern `^[a-zA-Z0-9_\-]+$`).
3. **No Blanket Reads**: All read and list operations evaluate ownership directly against path or resource data.
4. **PII Isolation**: Contact info (`phone`, `email`) is isolated within `/users/{userId}/private/{docId}` accessible only by the owning candidate.
5. **Score Integrity**: Scores are bounded integers (0 to 100), strings bounded by length limits, preventing Denial-of-Wallet payload bloat attacks.
6. **Curated Question Bank**: `/question_bank/{questionId}` documents can be read by authenticated users, but write access is restricted to administrative identities (`isAdmin()`).

## 2. The "Dirty Dozen" Payloads (Adversarial Tests)

1. **Unauthenticated Profile Read**: Anonymous user attempts `get /users/victim-uid`. Expect `PERMISSION_DENIED`.
2. **Cross-User Profile Mutate**: User `attacker-uid` attempts `update /users/victim-uid` changing `name` or `area`. Expect `PERMISSION_DENIED`.
3. **Impersonated Answer Write**: User `attacker-uid` attempts `set /users/attacker-uid/practice_answers/a1` with `userId: "victim-uid"`. Expect `PERMISSION_DENIED` (Identity mismatch).
4. **Oversized String Injection**: User attempts to create `practice_answers/a1` with `transcription` of 500KB (exceeds 10,000 char limit). Expect `PERMISSION_DENIED`.
5. **Path Traversal / Junk ID Injection**: User attempts `create /users/user123/mock_sessions/junk@#$!%^&*`. Expect `PERMISSION_DENIED` (ID pattern fail).
6. **Score Value Out-of-Bounds**: User submits `MockInterviewSession` with `overallScore: 9999`. Expect `PERMISSION_DENIED` (must be 0-100).
7. **PII Interception / Snoop**: User `user-a` attempts `get /users/user-b/private/info`. Expect `PERMISSION_DENIED`.
8. **Shadow Field Injection**: User sends `UserProfile` with shadow field `isAdmin: true` or `role: "admin"`. Expect `PERMISSION_DENIED` (`hasOnly` strict keys).
9. **Question Bank Hijack**: Non-admin candidate attempts `delete /question_bank/q1`. Expect `PERMISSION_DENIED`.
10. **Question Bank Unauthorized Creation**: Non-admin user attempts `set /question_bank/q1` with arbitrary question. Expect `PERMISSION_DENIED`.
11. **Negative Dimension Score**: User submits `contentScore: -25` in `MockInterviewSession`. Expect `PERMISSION_DENIED`.
12. **Blanket Query Scraping**: Attacker requests `collectionGroup('practice_answers')` without user constraint. Expect `PERMISSION_DENIED`.

## 3. Security Test Runner (firestore.rules.test.ts)
Demonstrates rejection of each of the 12 breach patterns ensuring mathematical zero-trust perimeter.
