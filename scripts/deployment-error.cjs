exports.deploymentError = (error, stage) => {
  const nodes = [error];
  const seen = new Set();
  const codes = [];
  const messages = [];
  while (nodes.length && seen.size < 12) {
    const node = nodes.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    codes.push(String(node.code || ""));
    messages.push(String(node.message || ""));
    nodes.push(node.cause, node.error, node.info?.error);
  }
  const text = messages.join(" ");
  let category = "UNKNOWN";
  let help =
    "Check RPC access and transaction status locally; do not share your .env.";
  if (
    codes.includes("INSUFFICIENT_FUNDS") ||
    /insufficient funds/i.test(text)
  ) {
    category = "INSUFFICIENT_FUNDS";
    help = "Fund the printed deployment wallet with testnet tBNB for gas.";
  } else if (/429|rate.?limit|too many requests/i.test(text)) {
    category = "RPC_RATE_LIMIT";
    help = "RPC rate limit reached. Wait or configure another BSC97 RPC.";
  } else if (
    codes.includes("NONCE_EXPIRED") ||
    codes.includes("REPLACEMENT_UNDERPRICED")
  ) {
    category = "NONCE_CONFLICT";
    help =
      "Check pending transactions from the deployment wallet before retrying.";
  } else if (codes.includes("CALL_EXCEPTION")) {
    category = "TRANSACTION_REVERTED";
    help =
      "Contract execution reverted. Check the last printed deployment stage and wallet transactions.";
  } else if (
    codes.some((c) =>
      [
        "NETWORK_ERROR",
        "TIMEOUT",
        "ETIMEDOUT",
        "ECONNREFUSED",
        "ECONNRESET",
        "ENOTFOUND",
        "EAI_AGAIN",
        "UND_ERR_CONNECT_TIMEOUT",
      ].includes(c),
    ) ||
    /timed? ?out|network|connect|socket|fetch failed/i.test(text)
  ) {
    category = "RPC_NETWORK";
    help =
      "Cannot communicate with BSC97 RPC. Check local proxy, firewall, DNS and RPC endpoint.";
  }
  // Never echo raw errors, RPC URLs, request payloads or signing material.
  return `Deployment failed at [${stage}]: ${category}. ${help}`;
};
