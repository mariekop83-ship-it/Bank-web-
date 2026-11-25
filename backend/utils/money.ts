/**
 * Exact monetary arithmetic using BigInt scaled by 10^4 (4 decimal places)
 * matching MySQL DECIMAL(19, 4). Zero IEEE-754 floating-point math.
 */

const SCALE = 10000n;
const RATE_SCALE = 100000000n; // 10^8 matching DECIMAL(18, 8)

export function parseDecimalToScaled(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') {
    return value * SCALE;
  }
  const str = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid monetary amount: ${str}`);
  }
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  if (fracPart.length > 4) {
    throw new Error(`Monetary precision exceeds 4 decimal places: ${str}`);
  }
  const paddedFrac = fracPart.padEnd(4, '0');
  const scaled = BigInt(wholePart) * SCALE + BigInt(paddedFrac);
  return negative ? -scaled : scaled;
}

export function formatScaledToDecimal(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

export function parseRateToScaled(rate: string | number): bigint {
  const str = String(rate).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid exchange rate: ${str}`);
  }
  const [whole, frac = ''] = str.split('.');
  const padded = frac.slice(0, 8).padEnd(8, '0');
  return BigInt(whole) * RATE_SCALE + BigInt(padded);
}

export function applyExchangeRate(amountScaled: bigint, rateStr: string, targetMinorUnits = 2): bigint {
  const rateScaled = parseRateToScaled(rateStr);
  const raw = (amountScaled * rateScaled) / RATE_SCALE;
  if (targetMinorUnits === 0) {
    return (raw / SCALE) * SCALE;
  }
  const factor = BigInt(10 ** (4 - targetMinorUnits));
  return (raw / factor) * factor;
}

export function calculateFeeScaled(
  amountScaled: bigint,
  flatFeeStr: string,
  percentFeeStr: string,
  minFeeStr: string,
  maxFeeStr: string | null
): bigint {
  const flat = parseDecimalToScaled(flatFeeStr || '0');
  // percentFeeStr is decimal ratio e.g. 0.0035 for 0.35%
  const pctScaled = parseDecimalToScaled(percentFeeStr || '0');
  const pctAmount = (amountScaled * pctScaled) / SCALE;
  let total = flat + pctAmount;

  // Round to 2 decimal places (100 scaled units)
  total = ((total + 50n) / 100n) * 100n;

  const min = parseDecimalToScaled(minFeeStr || '0');
  if (total < min) {
    total = min;
  }
  if (maxFeeStr !== null && maxFeeStr !== undefined && maxFeeStr !== '') {
    const max = parseDecimalToScaled(maxFeeStr);
    if (total > max) {
      total = max;
    }
  }
  return total;
}

export function assertPositiveScaled(scaled: bigint, label = 'Amount'): void {
  if (scaled <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }
}
