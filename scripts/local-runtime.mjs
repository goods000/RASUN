import path from "node:path";
import { root } from "./process.mjs";
export function localRuntime(runId, ports) {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) throw Error("Invalid local run ID");
  const dir = path.join(root, ".local/runs", runId);
  const urls = {
    runId,
    dapp: `http://localhost:${ports.dapp}`,
    admin: `http://localhost:${ports.admin}`,
    api: `http://127.0.0.1:${ports.api}`,
    chain: `http://127.0.0.1:${ports.chain}`,
    deployment: path.join(dir, "deployment.json"),
    database: "file:" + path.join(dir, "index.db"),
    logs: path.join(dir, "logs"),
  };
  return {
    urls,
    environment: {
      RASUN_DEV_RUN_ID: runId,
      RPC_URL: urls.chain,
      RASUN_LOCAL_RPC_URL: urls.chain,
      PUBLIC_RPC_URL: urls.chain,
      RASUN_API_URL: urls.api,
      DEPLOYMENT_FILE: urls.deployment,
      DATABASE_URL: urls.database,
      PORT: String(ports.api),
      CONFIRMATIONS: "0",
      RASUN_DAPP_PORT: String(ports.dapp),
      RASUN_ADMIN_PORT: String(ports.admin),
      RASUN_UI_STRICT_PORT: "1",
      CORS_ORIGINS: `${urls.dapp},http://127.0.0.1:${ports.dapp},${urls.admin},http://127.0.0.1:${ports.admin}`,
    },
  };
}
