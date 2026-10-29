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
    if (version !== this.version) return;
    this.account = accounts[0] || "";
    this.chainId = chain;
    this.touch();
  }
  assertReady(chainId: number) {
    if (!this.account) throw Error("CONNECT_FIRST");
    if (this.chainId !== chainId) throw Error("WRONG_NETWORK");
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
