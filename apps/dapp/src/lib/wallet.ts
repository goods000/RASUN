export type EIP1193 = {
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on?: (event: string, fn: (value?: any) => void) => void;
  removeListener?: (event: string, fn: (value?: any) => void) => void;
};
export class WalletSession {
  account = "";
  chainId = 0;
  version = 0;
  private listeners: Record<string, (value?: any) => void> = {};
  constructor(
    public raw: EIP1193 | null,
    private changed: () => void = () => {},
  ) {
    this.listeners = {
      accountsChanged: (accounts: string[]) => {
        this.account = accounts?.[0] || "";
        this.touch();
      },
      chainChanged: (id: string) => {
        this.chainId = Number(id);
        this.touch();
      },
      disconnect: () => {
        this.account = "";
        this.chainId = 0;
        this.touch();
      },
    };
    for (const [event, fn] of Object.entries(this.listeners))
      raw?.on?.(event, fn);
  }
  private touch() {
    this.version++;
    this.changed();
  }
  async connect() {
    if (!this.raw) throw Error("NO_WALLET");
    const version = this.version;
    const accounts = await this.raw.request({ method: "eth_requestAccounts" });
    const chain = Number(await this.raw.request({ method: "eth_chainId" }));
    if (version !== this.version) {
      if (this.chainId === 0 && this.account) {
        this.chainId = chain;
        this.touch();
      }
      return;
    }
    this.account = accounts[0] || "";
    this.chainId = chain;
    this.touch();
  }
  assertReady(chainId: number) {
    if (!this.account) throw Error("CONNECT_FIRST");
    if (this.chainId !== chainId) throw Error("WRONG_NETWORK");
  }
  async assertLocalRpc(identity?: { number: number; hash: string } | null) {
    if (!identity) return;
    if (!this.raw) throw Error("NO_WALLET");
    const block = await this.raw.request({
      method: "eth_getBlockByNumber",
      params: ["0x" + identity.number.toString(16), false],
    });
    if (block?.hash?.toLowerCase() !== identity.hash.toLowerCase())
      throw Error("WRONG_RPC");
  }
  guardedProvider(
    chainId: number,
    generation: number,
    sender: string,
    localIdentity?: { number: number; hash: string } | null,
  ): EIP1193 {
    const raw = this.raw;
    if (!raw) throw Error("NO_WALLET");
    const valid = () => {
      if (
        this.version !== generation ||
        this.account.toLowerCase() !== sender.toLowerCase()
      )
        throw Error("WALLET_CHANGED");
      this.assertReady(chainId);
    };
    return {
      request: async (request) => {
        if (
          request.method !== "eth_sendTransaction" &&
          !(localIdentity && request.method === "eth_estimateGas")
        )
          return raw.request(request);
        valid();
        const actualChain = Number(
          await raw.request({ method: "eth_chainId" }),
        );
        const accounts = await raw.request({ method: "eth_accounts" });
        valid();
        if (actualChain !== chainId) throw Error("WRONG_NETWORK");
        if (localIdentity) {
          await this.assertLocalRpc(localIdentity);
          valid();
        }
        if (request.method === "eth_estimateGas") return raw.request(request);
        const transaction = request.params?.[0];
        if (
          !accounts?.some(
            (a: string) => a.toLowerCase() === sender.toLowerCase(),
          ) ||
          !transaction ||
          transaction.from?.toLowerCase() !== sender.toLowerCase()
        )
          throw Error("WALLET_CHANGED");
        // Re-read gas at the send boundary, including after an approval.
        if (chainId === 97 || localIdentity) {
          const balance = BigInt(
            await raw.request({
              method: "eth_getBalance",
              params: [sender, "latest"],
            }),
          );
          valid();
          if (balance === 0n)
            throw Object.assign(Error("Insufficient funds for gas"), {
              code: "INSUFFICIENT_FUNDS",
            });
        }
        return raw.request({
          method: "eth_sendTransaction",
          params: [{ ...transaction, chainId: "0x" + chainId.toString(16) }],
        });
      },
    };
  }
  async switchChain(config: any) {
    if (!this.raw) throw Error("NO_WALLET");
    const chainId = "0x" + Number(config.chainId).toString(16);
    try {
      await this.raw.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } catch (e: any) {
      if (e.code !== 4902 || !config.rpcUrl) throw e;
      await this.raw.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: config.network,
            nativeCurrency: {
              name: config.chainId === 97 ? "tBNB" : "ETH",
              symbol: config.chainId === 97 ? "tBNB" : "ETH",
              decimals: 18,
            },
            rpcUrls: [config.rpcUrl],
            ...(config.explorer
              ? { blockExplorerUrls: [config.explorer] }
              : {}),
          },
        ],
      });
    }
    this.chainId = Number(await this.raw.request({ method: "eth_chainId" }));
    this.touch();
  }
  dispose() {
    for (const [event, fn] of Object.entries(this.listeners))
      this.raw?.removeListener?.(event, fn);
  }
}
