const { createRequire } = require("node:module");
const apiRequire = createRequire(
  require("node:path").join(__dirname, "../apps/api/package.json"),
);
const { FetchRequest, JsonRpcProvider } = apiRequire("ethers");
function rpcRequest(url, settings = process.env) {
  const target = new URL(url);
  const hostname = target.hostname.toLowerCase();
  const request = new FetchRequest(url);
  request.timeout = 15000;
  const loopback =
    hostname === "localhost" || hostname === "[::1]" || /^127\./.test(hostname);
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  const bypass = String(settings.no_proxy || settings.NO_PROXY || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((entry) => {
      entry = entry.toLowerCase();
      if (entry === "*") return true;
      let host = entry;
      const match = entry.match(/^(.*):(\d+)$/);
      if (match) {
        if (match[2] !== port) return false;
        host = match[1];
      }
      if (host.startsWith("*.")) host = host.slice(1);
      return host.startsWith(".")
        ? hostname.endsWith(host) || hostname === host.slice(1)
        : hostname === host;
    });
  const proxy =
    target.protocol === "https:"
      ? settings.https_proxy ||
        settings.HTTPS_PROXY ||
        settings.http_proxy ||
        settings.HTTP_PROXY
      : settings.http_proxy || settings.HTTP_PROXY;
  if (proxy && !loopback && !bypass) {
    let parsed;
    try {
      parsed = new URL(proxy);
    } catch {
      throw Error("Invalid HTTP proxy URL; expected http://127.0.0.1:7890");
    }
    if (!["http:", "https:"].includes(parsed.protocol))
      throw Error("RPC proxy requires HTTP or HTTPS CONNECT, not a SOCKS port");
    const { HttpsProxyAgent } = apiRequire("https-proxy-agent");
    request.getUrlFunc = FetchRequest.createGetUrlFunc({
      agent: new HttpsProxyAgent(proxy),
    });
  }
  return request;
}
function createRpcProvider(url, settings = process.env) {
  return new JsonRpcProvider(rpcRequest(url, settings), undefined, {
    cacheTimeout: -1,
  });
}
module.exports = { rpcRequest, createRpcProvider };
