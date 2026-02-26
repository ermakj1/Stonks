/** Standard normal CDF via Abramowitz & Stegun approximation */
function normCdf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Black-Scholes delta for a European option.
 * @param S     Spot (underlying) price
 * @param K     Strike price
 * @param T     Time to expiry in years (DTE / 365)
 * @param iv    Implied volatility as decimal (0.30 = 30%)
 * @param isCall true for call, false for put
 * @param r     Risk-free rate (default 5%)
 */
export function bsDelta(
  S: number,
  K: number,
  T: number,
  iv: number,
  isCall: boolean,
  r = 0.05,
): number {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) {
    return isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  }
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T));
  return isCall ? normCdf(d1) : normCdf(d1) - 1;
}
