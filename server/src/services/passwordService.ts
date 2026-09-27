import bcrypt from 'bcryptjs';

/**
 * bcrypt cost factor. Production uses 10; the test environment lowers it via
 * BCRYPT_ROUNDS so hundreds of seeded logins do not saturate the CPU.
 */
const SALT_ROUNDS = (() => {
  const n = Number(process.env.BCRYPT_ROUNDS);
  return Number.isInteger(n) && n >= 4 && n <= 15 ? n : 10;
})();

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
