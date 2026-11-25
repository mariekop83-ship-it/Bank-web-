import crypto from 'crypto';

const DEFAULT_SORT_PREFIX = '0406';
const DEFAULT_BIC_SWIFT = 'MRDNGB2L';

export function computeIbanCheckDigits(countryCode: string, bban: string): string {
  const rearranged = `${bban}${countryCode.toUpperCase()}00`;
  let numeric = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') {
      numeric += ch;
    } else if (ch >= 'A' && ch <= 'Z') {
      numeric += String(ch.charCodeAt(0) - 55);
    }
  }

  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const block = `${remainder}${numeric.slice(i, i + 7)}`;
    remainder = Number(block) % 97;
  }

  const check = 98 - remainder;
  return String(check).padStart(2, '0');
}

export function isValidIban(iban: string): boolean {
  const clean = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;
  const rearranged = `${clean.slice(4)}${clean.slice(0, 4)}`;
  let numeric = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') {
      numeric += ch;
    } else {
      numeric += String(ch.charCodeAt(0) - 55);
    }
  }
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(`${remainder}${numeric.slice(i, i + 7)}`) % 97;
  }
  return remainder === 1;
}

export function generateRealisticAccountDetails(): {
  accountNumber: string;
  iban: string;
  routingNumber: string;
  bicSwift: string;
} {
  const branchSuffix = String(crypto.randomInt(10, 99));
  const sortDigits = `${DEFAULT_SORT_PREFIX}${branchSuffix}`;
  const routingNumber = `${sortDigits.slice(0, 2)}-${sortDigits.slice(2, 4)}-${sortDigits.slice(4, 6)}`;

  const prefix2 = String(crypto.randomInt(20, 99));
  const suffix8 = String(crypto.randomInt(10000000, 99999999));
  const accountNumber = `${prefix2}${suffix8}`;

  const bban = `MRDN${sortDigits}${suffix8}`;
  const checkDigits = computeIbanCheckDigits('GB', bban);
  const iban = `GB${checkDigits}${bban}`;

  return {
    accountNumber,
    iban,
    routingNumber,
    bicSwift: DEFAULT_BIC_SWIFT,
  };
}

export async function allocateUniqueAccountDetails(conn: {
  query: (sql: string, params?: any[]) => Promise<any>;
}) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const candidate = generateRealisticAccountDetails();
    const [existing]: any = await conn.query(
      `SELECT id FROM bank_accounts WHERE account_number = ? OR iban = ? LIMIT 1`,
      [candidate.accountNumber, candidate.iban]
    );
    if (!existing || existing.length === 0) {
      return candidate;
    }
  }
  throw new Error('Unable to allocate unique bank account identifiers. Please retry.');
}
