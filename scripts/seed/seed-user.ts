/**
 * Seed a local dev user with email/password auth.
 * Uses Better Auth's hashPassword so the credentials work with sign-in.
 *
 * Usage: pnpm tsx scripts/seed-user.ts
 *
 * Default credentials:
 *   Email:    dev@keeperhub.local
 *   Password: Test1234!
 *
 * Override via env:
 *   SEED_EMAIL=me@example.com SEED_PASSWORD=secret pnpm tsx scripts/seed-user.ts
 */

import "dotenv/config";

import { randomBytes, scrypt } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "../../lib/db/connection-utils";
import { accounts, member, organization, sessions, users } from "../../lib/db/schema";
import { generateId } from "../../lib/utils/id";

const EMAIL = process.env.SEED_EMAIL ?? "dev@keeperhub.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "Test1234!";
const NAME = process.env.SEED_NAME ?? "Dev User";
const ORG_NAME = process.env.SEED_ORG_NAME ?? "Dev Organization";
const ORG_SLUG = process.env.SEED_ORG_SLUG ?? "dev-organization";

const SCRYPT_CONFIG = { N: 16_384, r: 16, p: 1, dkLen: 64 } as const;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function scryptAsync(
  password: string,
  salt: string,
  keylen: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      {
        N: SCRYPT_CONFIG.N,
        r: SCRYPT_CONFIG.r,
        p: SCRYPT_CONFIG.p,
        maxmem: 128 * SCRYPT_CONFIG.N * SCRYPT_CONFIG.r * 2,
      },
      (err, derivedKey) => {
        if (err) {
          reject(err);
        } else {
          resolve(derivedKey);
        }
      }
    );
  });
}

async function hashPassword(password: string): Promise<string> {
  const saltBytes = randomBytes(16);
  const salt = bytesToHex(saltBytes);
  const key = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    SCRYPT_CONFIG.dkLen
  );
  return `${salt}:${bytesToHex(key)}`;
}

async function main(): Promise<void> {
  const connectionString = getDatabaseUrl();
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, EMAIL))
      .limit(1);

    let userId: string;

    if (existing.length > 0) {
      userId = existing[0].id;
      const hash = await hashPassword(PASSWORD);

      await db
        .update(accounts)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(accounts.userId, userId));

      await db
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, userId));

      console.log(`Updated existing user: ${EMAIL}`);
      console.log(`  Password reset to: ${PASSWORD}`);
    } else {
      userId = generateId();
      const accountId = generateId();
      const hash = await hashPassword(PASSWORD);
      const now = new Date();

      await db.insert(users).values({
        id: userId,
        name: NAME,
        email: EMAIL,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        isAnonymous: false,
      });

      await db.insert(accounts).values({
        id: accountId,
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
        createdAt: now,
        updatedAt: now,
      });

      console.log(`Created user: ${EMAIL}`);
      console.log(`  Password: ${PASSWORD}`);
    }

    const orgRows = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, ORG_SLUG))
      .limit(1);
    const organizationId = orgRows[0]?.id ?? generateId();
    if (orgRows.length === 0) {
      await db.insert(organization).values({
        id: organizationId,
        name: ORG_NAME,
        slug: ORG_SLUG,
        createdAt: new Date(),
      });
    }

    const memberRows = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1);
    if (memberRows.length === 0) {
      await db.insert(member).values({
        id: generateId(),
        organizationId,
        userId,
        role: "owner",
        createdAt: new Date(),
      });
    }

    await db
      .update(sessions)
      .set({ activeOrganizationId: organizationId, updatedAt: new Date() })
      .where(eq(sessions.userId, userId));

    console.log(`  Organization: ${ORG_NAME} (${organizationId})`);
    console.log("  Active organization applied to existing sessions");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to seed user:", error);
  process.exit(1);
});
