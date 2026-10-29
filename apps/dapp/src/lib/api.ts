export async function api(path: string) {
  const response = await fetch("/api/" + path, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Error(body.message || `HTTP ${response.status}`);
  }
  return response.json();
}
export function amount(value: unknown, decimals = 3) {
  if (value === null || value === undefined) return "—";
  try {
    const x = BigInt(String(value));
    const whole = x / 10n ** 18n;
    const fraction = (x % 10n ** 18n)
      .toString()
      .padStart(18, "0")
      .slice(0, decimals);
    return (
      whole.toLocaleString("en-US") +
      (fraction && Number(fraction) > 0
        ? "." + fraction.replace(/0+$/, "")
        : "")
    );
  } catch {
    return "—";
  }
}
export function short(address: string) {
  return address ? address.slice(0, 6) + "…" + address.slice(-4) : "—";
}
