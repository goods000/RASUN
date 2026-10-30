<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  BrowserProvider,
  Contract,
  isAddress,
  ZeroAddress,
  parseUnits,
} from "ethers";
import NativeButton from "../../components/NativeButton";
import NativeInput from "../../components/NativeInput";
import { WalletSession } from "../../lib/wallet";
import { api, amount, short } from "../../lib/api";
import { messages, languages } from "../../lib/i18n";
const locale = ref(localStorage.getItem("rasun-language") || "zh-CN");
if (!messages[locale.value]) locale.value = "zh-CN";
const t = (key: string) => messages[locale.value][key] || key;
const tab = ref("overview"),
  config = ref<any>(null),
  overview = ref<any>(null),
  wallet = ref<any>(null),
  ranks = ref<any[]>([]),
  events = ref<any[]>([]);
const market = ref<any>(null),
  marketError = ref(false),
  swapAmount = ref("1"),
  slippage = ref("1"),
  lastTx = ref("");
const sandbox = computed(
  () =>
    config.value?.sandbox === true &&
    [97, 31337].includes(config.value.chainId),
);
const nativeSymbol = computed(() =>
  config.value?.chainId === 97 ? "tBNB" : "ETH",
);
const noGas = computed(
  () =>
    sandbox.value &&
    (!market.value || BigInt(market.value.nativeBalance || "0") === 0n),
);
const canSend = computed(
  () =>
    connected.value &&
    !wrongNetwork.value &&
    !busy.value &&
    !error.value &&
    !!config.value &&
    (!sandbox.value || (!marketError.value && !!market.value && !noGas.value)),
);
const account = ref(""),
  chain = ref(0),
  notice = ref(""),
  noticeType = ref(""),
  error = ref(false),
  loading = ref(true),
  busy = ref("");
const rankPage = ref(1),
  rankTotal = ref(0),
  recordPage = ref(1),
  recordTotal = ref(0),
  inviter = ref("");
let refreshId = 0,
  timer: ReturnType<typeof setInterval>;
const session = new WalletSession((window as any).ethereum || null, () => {
  account.value = session.account;
  chain.value = session.chainId;
  wallet.value = null;
  market.value = null;
  lastTx.value = "";
  events.value = [];
  recordPage.value = 1;
  void refresh();
});
const connected = computed(() => !!account.value);
const wrongNetwork = computed(
  () => connected.value && config.value && chain.value !== config.value.chainId,
);
const progress = computed(() =>
  overview.value
    ? Math.min(
        100,
        Number(
          (BigInt(overview.value.totalMinted) * 10000n) /
            BigInt(overview.value.cap),
        ) / 100,
      )
    : 0,
);
const inviteLink = computed(() =>
  account.value
    ? location.origin + location.pathname + "?ref=" + account.value + "#/"
    : "",
);
function changeLocale(e: Event) {
  locale.value = (e.target as HTMLSelectElement).value;
  localStorage.setItem("rasun-language", locale.value);
  document.documentElement.lang = locale.value;
}
function feedback(key: string, type = "error") {
  notice.value = t(key);
  noticeType.value = type;
}
async function refresh() {
  const request = ++refreshId;
  const who = account.value;
  loading.value = !overview.value;
  try {
    const [c, o, r, w, h] = await Promise.all([
      api("config"),
      api("overview"),
      api(`ranking?page=${rankPage.value}&limit=10`),
      who ? api("wallet/" + who) : null,
      who
        ? api(
            `events?event=Claimed&wallet=${who}&page=${recordPage.value}&limit=10`,
          )
        : null,
    ]);
    if (request !== refreshId) return;
    config.value = c;
    if (c.sandbox) {
      try {
        const m = await api("market" + (who ? "?wallet=" + who : ""));
        if (request !== refreshId) return;
        market.value = m;
        marketError.value = false;
      } catch {
        if (request !== refreshId) return;
        market.value = null;
        marketError.value = true;
      }
    } else {
      market.value = null;
      marketError.value = false;
    }
    overview.value = o;
    ranks.value = r.items;
    rankTotal.value = r.total;
    wallet.value = w;
    events.value = h?.items || [];
    recordTotal.value = h?.total || 0;
    error.value = false;
  } catch {
    if (request === refreshId) {
      error.value = true;
      wallet.value = null;
    }
  } finally {
    if (request === refreshId) loading.value = false;
  }
}
async function connect() {
  try {
    if (wrongNetwork.value) await session.switchChain(config.value);
    else await session.connect();
    notice.value = "";
  } catch (e: any) {
    feedback(e.message === "NO_WALLET" ? "noWallet" : "failed");
  }
}
async function transact(
  kind:
    | "holding"
    | "referral"
    | "bind"
    | "historyHolding"
    | "historyReferral"
    | "faucet"
    | "buy"
    | "sell"
    | "begin"
    | "process",
) {
  if (!canSend.value) {
    if (noGas.value) feedback("getGas");
    return;
  }
  if (
    ["holding", "referral"].includes(kind) &&
    BigInt(wallet.value?.claimable?.[kind] || "0") <= 0n
  )
    return;
  if (
    kind === "bind" &&
    (!isAddress(inviter.value) ||
      inviter.value.toLowerCase() === account.value.toLowerCase() ||
      inviter.value === ZeroAddress)
  ) {
    feedback("invalidInvite");
    return;
  }
  const generation = session.version;
  const sender = account.value;
  busy.value = kind;
  feedback("pending", "pending");
  try {
    session.assertReady(config.value.chainId);
    await session.assertLocalRpc(config.value.localIdentity);
    if (generation !== session.version) throw Error("WALLET_CHANGED");
    const provider = new BrowserProvider(
      session.guardedProvider(
        config.value.chainId,
        generation,
        sender,
        config.value.localIdentity,
      ),
    );
    const signer = await provider.getSigner(sender);
    if (generation !== session.version) throw Error("WALLET_CHANGED");
    const currentConfig = config.value;
    const contractFor = (name: string) =>
      new Contract(
        currentConfig.addresses[name],
        currentConfig.abis[name],
        signer,
      );
    let tx;
    if (kind === "buy" || kind === "sell") {
      if (!sandbox.value) throw Error("FAILED");
      const input = parseUnits(swapAmount.value, 18);
      const bps = Math.round(Number(slippage.value) * 100);
      if (input <= 0n || !Number.isFinite(bps) || bps < 10 || bps > 1000)
        throw Error("FAILED");
      const pool = contractFor("pool");
      // A failed quote exits before any approval or swap is sent.
      const quoted = BigInt(
        await pool[kind === "buy" ? "quoteBuy" : "quoteSell"](input),
      );
      const netQuote = kind === "buy" ? (quoted * 9700n) / 10000n : quoted;
      const minimum = (netQuote * BigInt(10000 - bps)) / 10000n;
      if (minimum <= 0n) throw Error("FAILED");
      const asset = contractFor(kind === "buy" ? "quote" : "token");
      const spender = currentConfig.addresses.pool;
      const allowance = BigInt(await asset.allowance(sender, spender));
      // Replace any old approval with only the amount explicitly requested.
      if (allowance !== input) {
        if (allowance > 0n) {
          const reset = await asset.approve(spender, 0);
          await reset.wait();
        }
        const approval = await asset.approve(spender, input);
        const approvalReceipt = await approval.wait();
        if (!approvalReceipt || approvalReceipt.status !== 1)
          throw Error("FAILED");
      }
      if (generation !== session.version) throw Error("WALLET_CHANGED");
      tx = await pool[kind](input, minimum);
    } else if (kind === "faucet") {
      if (!sandbox.value) throw Error("FAILED");
      tx = await contractFor("faucet").claim();
    } else if (kind === "begin" || kind === "process") {
      if (!sandbox.value) throw Error("FAILED");
      tx =
        kind === "begin"
          ? await contractFor("mining").beginDay()
          : await contractFor("mining").process(128);
    } else if (kind === "bind")
      tx = await contractFor("registry").bind(inviter.value);
    else
      tx = await contractFor("mining").claim(
        kind === "holding" || kind === "historyHolding" ? 0 : 1,
        365,
      );
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw Error("FAILED");
    if (generation !== session.version) {
      feedback("walletChanged");
      return;
    }
    lastTx.value = tx.hash;
    feedback("success", "success");
    await refresh();
  } catch (e: any) {
    if (generation !== session.version) {
      feedback("walletChanged");
      return;
    }
    if (String(e.message).includes("WRONG_RPC")) {
      notice.value = t("wrongRpc") + " " + config.value.rpcUrl;
      noticeType.value = "error";
      return;
    }
    if (
      e.code === "INSUFFICIENT_FUNDS" ||
      /insufficient funds/i.test(String(e.message))
    ) {
      feedback("getGas");
      return;
    }
    feedback(
      e.message === "WRONG_NETWORK"
        ? "switch"
        : e.message === "CONNECT_FIRST"
          ? "connect"
          : e.message === "WALLET_CHANGED"
            ? "walletChanged"
            : "failed",
    );
  } finally {
    busy.value = "";
  }
}
async function watchAsset(name: "token" | "quote") {
  try {
    session.assertReady(config.value.chainId);
    await session.raw!.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: config.value.addresses[name],
          symbol: name === "token" ? "RASUN" : "tUSDT",
          decimals: 18,
        },
      } as any,
    });
  } catch {
    feedback("failed");
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    feedback("copied", "success");
  } catch {
    feedback("failed");
  }
}
function date(ts: number) {
  return new Intl.DateTimeFormat(locale.value, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts * 1000));
}
function jumpEconomics() {
  document.getElementById("economics")?.scrollIntoView({ behavior: "smooth" });
}
const settled = computed(
  () =>
    overview.value &&
    BigInt(overview.value.nextDay) >= BigInt(overview.value.currentDay),
);
function pageRank(delta: number) {
  rankPage.value += delta;
  void refresh();
}
function pageRecords(delta: number) {
  recordPage.value += delta;
  void refresh();
}
onMounted(() => {
  document.documentElement.lang = locale.value;
  const query = new URLSearchParams(location.search);
  const hashQuery = new URLSearchParams(location.hash.split("?")[1] || "");
  inviter.value = query.get("ref") || hashQuery.get("ref") || "";
  void refresh();
  timer = setInterval(() => void refresh(), 15000);
});
onUnmounted(() => {
  session.dispose();
  clearInterval(timer);
  refreshId++;
});
</script>
<template>
  <view class="app-shell">
    <view class="topbar">
      <view class="brand" @click="tab = 'overview'"
        ><view class="brand-mark">R<span>↗</span></view
        ><view
          >RASUN<text class="brand-sub">ON-CHAIN ECOSYSTEM</text></view
        ></view
      >
      <nav class="desktop-nav" aria-label="Main">
        <NativeButton
          v-for="item in ['overview', 'mining', 'referral', 'records']"
          :key="item"
          :class="{ active: tab === item }"
          @click="tab = item"
          >{{ t(item) }}</NativeButton
        >
      </nav>
      <view class="top-actions"
        ><select
          :aria-label="t('language')"
          :value="locale"
          @change="changeLocale"
        >
          <option v-for="l in languages" :key="l.code" :value="l.code">
            {{ l.label }}
          </option></select
        ><NativeButton
          data-testid="connect"
          class="wallet-button"
          @click="connect"
          ><span class="wallet-icon">▣</span
          >{{
            wrongNetwork
              ? t("switch")
              : connected
                ? short(account)
                : t("connect")
          }}</NativeButton
        ></view
      >
    </view>
    <view class="network-strip"
      ><span class="live-dot"></span>{{ config?.network || t("unavailable")
      }}<span class="strip-divider">/</span>{{ t("test") }}</view
    >
    <view v-if="notice" role="status" :class="['notice', noticeType]"
      >{{ notice
      }}<NativeButton aria-label="Close" @click="notice = ''"
        >×</NativeButton
      ></view
    >
    <view v-if="error" role="alert" class="error-panel"
      >{{ t("unavailable")
      }}<NativeButton @click="refresh">{{ t("retry") }} ↻</NativeButton></view
    >
    <view v-if="loading" class="loading-label">{{ t("loading") }}</view>
    <main>
      <section
        v-if="sandbox"
        data-testid="sandbox-panel"
        class="panel sandbox-panel"
      >
        <h2>
          {{ t("sandbox") }} ·
          {{ config.chainId === 97 ? "BSC Testnet 97" : "Local fixture 31337" }}
        </h2>
        <p v-if="config.accelerated">
          {{ t("accelerated") }} · {{ config.epochSeconds / 60 }} min / epoch
        </p>
        <p>{{ t("testPool") }}</p>
        <p v-if="marketError" role="alert">{{ t("marketUnavailable") }}</p>
        <p data-testid="native-balance">
          {{ t("gasBalance") }}: {{ amount(market?.nativeBalance, 6) }}
          {{ nativeSymbol }}
        </p>
        <p v-if="connected && noGas">
          {{ t("getGas") }}
          <a
            href="https://www.bnbchain.org/en/testnet-faucet"
            target="_blank"
            rel="noreferrer"
            >BNB Chain faucet ↗</a
          >
        </p>
        <p data-testid="quote-balance">
          tUSDT: {{ amount(market?.quoteBalance) }} · RASUN:
          {{ amount(wallet?.balance) }}
        </p>
        <div class="sandbox-actions">
          <NativeButton
            data-testid="faucet-claim"
            class="primary pink"
            :disabled="!canSend || !market?.faucet?.available"
            @click="transact('faucet')"
            >{{ t("faucet") }}</NativeButton
          >
          <NativeButton
            :disabled="!connected || !!busy"
            @click="watchAsset('token')"
            >{{ t("importToken") }} RASUN</NativeButton
          >
          <NativeButton
            :disabled="!connected || !!busy"
            @click="watchAsset('quote')"
            >{{ t("importToken") }} tUSDT</NativeButton
          >
        </div>
        <p v-if="market?.faucet?.nextClaimAt">
          {{ t("faucetNext") }}: {{ date(Number(market.faucet.nextClaimAt)) }}
        </p>
        <label
          >{{ t("swapAmount") }}
          <NativeInput
            data-testid="swap-amount"
            v-model="swapAmount"
            inputmode="decimal"
        /></label>
        <label
          >{{ t("slippage") }} (%)
          <NativeInput
            data-testid="swap-slippage"
            v-model="slippage"
            inputmode="decimal"
        /></label>
        <p>{{ t("approvalNote") }}</p>
        <div class="sandbox-actions">
          <NativeButton
            data-testid="swap-buy"
            class="primary"
            :disabled="!canSend"
            @click="transact('buy')"
            >{{ t("buy") }}</NativeButton
          >
          <NativeButton
            data-testid="swap-sell"
            class="primary pink"
            :disabled="!canSend"
            @click="transact('sell')"
            >{{ t("sell") }}</NativeButton
          >
          <NativeButton
            data-testid="settlement-begin"
            :disabled="
              !canSend || settled || BigInt(overview?.activeDay || '0') > 0n
            "
            @click="transact('begin')"
            >{{ t("beginSettlement") }}</NativeButton
          >
          <NativeButton
            data-testid="settlement-process"
            :disabled="!canSend || BigInt(overview?.activeDay || '0') === 0n"
            @click="transact('process')"
            >{{ t("processSettlement") }} (128)</NativeButton
          >
        </div>
        <p>
          {{ t("settlement") }}: {{ overview?.nextDay }} /
          {{ overview?.currentDay }} · {{ t("gas") }}
        </p>
        <a
          v-if="config.explorer"
          :href="config.explorer + '/address/' + config.addresses.token"
          target="_blank"
          rel="noreferrer"
          >RASUN · BscScan ↗</a
        >
      </section>
      <p v-if="lastTx" class="panel">
        <a
          v-if="config?.explorer"
          :href="config.explorer + '/tx/' + lastTx"
          target="_blank"
          rel="noreferrer"
          >{{ t("tx") }} · {{ short(lastTx) }} ↗</a
        ><span v-else>{{ t("tx") }}: {{ lastTx }}</span>
      </p>
      <section v-if="tab === 'overview'" class="hero">
        <view class="hero-copy"
          ><view class="eyebrow"><span></span>{{ t("tagline") }}</view>
          <h1>
            {{ t("hero1") }}<span>{{ t("hero2") }}</span>
          </h1>
          <p>{{ t("heroDesc") }}</p>
          <view class="hero-actions"
            ><NativeButton class="primary" @click="tab = 'mining'"
              >{{ t("explore") }} <span>↗</span></NativeButton
            ><NativeButton class="text-button" @click="jumpEconomics"
              >{{ t("mechanism") }} <span>↓</span></NativeButton
            ></view
          ><view class="hero-signature"
            ><span class="tiny-orbit">✦</span> BSC <i></i> FULLY ON-CHAIN
            <i></i> RASUN</view
          ></view
        >
        <view class="radar-art" aria-hidden="true"
          ><view class="radar-glow"></view><view class="orbit orbit-one"></view
          ><view class="orbit orbit-two"></view
          ><view class="orbit orbit-three"></view
          ><view class="orbit-streak"></view
          ><view class="coin"><span>R</span><i>↗</i></view
          ><view class="art-label label-a">✧ <span>HOLD TO GROW</span></view
          ><view class="art-label label-b"
            ><span class="live-dot"></span> POWERED BY CONSENSUS</view
          ><view class="spark spark-a">✦</view
          ><view class="spark spark-b">✧</view></view
        >
      </section>
      <section v-if="tab === 'overview'" class="stats-grid">
        <view class="stat"
          ><view class="stat-top"
            ><span>{{ t("cap") }}</span
            ><span class="stat-symbol">◈</span></view
          ><strong>{{ amount(overview?.cap, 0) }}</strong
          ><span class="unit">RASUN</span></view
        >
        <view class="stat"
          ><view class="stat-top"
            ><span>{{ t("emission") }}</span
            ><span class="stat-symbol">↗</span></view
          ><strong>{{ amount(overview?.todayEmission) }}</strong
          ><span class="unit">RASUN / DAY</span></view
        >
        <view class="stat"
          ><view class="stat-top"
            ><span>{{ t("burned") }}</span
            ><span class="stat-symbol">♧</span></view
          ><strong>{{ amount(overview?.totalBurned) }}</strong
          ><span class="unit">RASUN</span></view
        >
        <view class="stat"
          ><view class="stat-top"
            ><span>{{ t("price") }}</span
            ><span class="stat-symbol">⌁</span></view
          ><strong>{{
            overview?.price ? "$" + amount(overview.price, 4) : "—"
          }}</strong
          ><span class="unit">{{
            overview?.priceStatus === "test" ? "TEST ORACLE" : "USDT / RASUN"
          }}</span></view
        >
      </section>
      <view
        v-if="['overview', 'mining', 'referral'].includes(tab)"
        class="section-heading"
        ><view
          ><view class="eyebrow small">THE POWER OF PARTICIPATION</view>
          <h2>{{ tab === "referral" ? t("referral") : t("mining") }}</h2></view
        ><span class="section-caption">{{ t("networkShare") }} × 2</span></view
      >
      <section
        v-if="['overview', 'mining', 'referral'].includes(tab)"
        class="mining-grid"
      >
        <article class="mining-card holding">
          <view class="card-heading"
            ><view class="feature-icon">◈</view
            ><view class="share-pill">50% ALLOCATION</view></view
          >
          <h3>{{ t("holdTitle") }}</h3>
          <p>{{ t("holdDesc") }}</p>
          <view class="card-metrics"
            ><view
              ><span>{{ t("balance") }}</span
              ><strong
                >{{ amount(wallet?.balance) }} <small>RASUN</small></strong
              ></view
            ><view
              ><span>{{ t("power") }}</span
              ><strong
                >{{ wallet?.holdingPower ?? "—" }} <small>POWER</small></strong
              ></view
            ></view
          ><view class="claim-row"
            ><view
              ><span>{{ t("claimable") }}</span
              ><strong
                >{{ amount(wallet?.claimable?.holding, 6) }}
                <small>RASUN</small></strong
              ></view
            ><NativeButton
              data-testid="holding-claim"
              :disabled="
                !connected ||
                wrongNetwork ||
                !!busy ||
                error ||
                !canSend ||
                BigInt(wallet?.claimable?.holding || '0') <= 0n
              "
              class="primary"
              @click="transact('holding')"
              >{{ busy === "holding" ? t("pending") : t("claim")
              }}<span v-if="!busy">↗</span></NativeButton
            ></view
          >
          <NativeButton
            v-if="
              wallet?.canAdvance?.holding &&
              BigInt(wallet?.claimable?.holding || '0') === 0n
            "
            :disabled="!canSend"
            @click="transact('historyHolding')"
            >{{ t("advance") }} · {{ t("gas") }}</NativeButton
          >
        </article>
        <article class="mining-card referral">
          <view class="card-heading"
            ><view class="feature-icon">⌘</view
            ><view class="share-pill">50% ALLOCATION</view></view
          >
          <h3>{{ t("refTitle") }}</h3>
          <p>{{ t("refDesc") }}</p>
          <view class="card-metrics"
            ><view
              ><span>{{ t("directs") }}</span
              ><strong
                >{{ wallet ? wallet.referrals.length : "—" }}
                <small>DIRECT</small></strong
              ></view
            ><view
              ><span>{{ t("power") }}</span
              ><strong
                >{{ amount(wallet?.referralPower) }}
                <small>POWER</small></strong
              ></view
            ></view
          ><view class="claim-row"
            ><view
              ><span>{{ t("claimable") }}</span
              ><strong
                >{{ amount(wallet?.claimable?.referral, 6) }}
                <small>RASUN</small></strong
              ></view
            ><NativeButton
              data-testid="referral-claim"
              :disabled="
                !connected ||
                wrongNetwork ||
                !!busy ||
                error ||
                !canSend ||
                BigInt(wallet?.claimable?.referral || '0') <= 0n
              "
              class="primary pink"
              @click="transact('referral')"
              >{{ busy === "referral" ? t("pending") : t("claim")
              }}<span v-if="!busy">↗</span></NativeButton
            ></view
          >
          <NativeButton
            v-if="
              wallet?.canAdvance?.referral &&
              BigInt(wallet?.claimable?.referral || '0') === 0n
            "
            :disabled="!canSend"
            @click="transact('historyReferral')"
            >{{ t("advance") }} · {{ t("gas") }}</NativeButton
          >
        </article>
      </section>
      <p
        v-if="['overview', 'mining', 'referral'].includes(tab)"
        class="footnote"
      >
        ⓘ {{ t("snapshot") }} {{ t("gas") }}
      </p>
      <section v-if="tab === 'referral'" class="panel invite-panel">
        <view
          ><view class="eyebrow small">GROW TOGETHER</view>
          <h2>{{ t("invite") }}</h2>
          <p>{{ t("bindNote") }}</p>
          <view class="invite-link"
            >{{ inviteLink || t("connect")
            }}<NativeButton :disabled="!connected" @click="copy"
              >{{ t("copy") }} ↗</NativeButton
            ></view
          ><label>{{ t("inviter") }}</label
          ><view
            v-if="wallet?.inviter && wallet.inviter !== ZeroAddress"
            class="address-value"
            >{{ wallet.inviter }}</view
          ><view v-else class="bind-row"
            ><NativeInput
              data-testid="inviter-input"
              v-model="inviter"
              placeholder="0x…"
              :aria-label="t('inviter')"
            /><NativeButton
              data-testid="bind"
              class="primary"
              :disabled="!canSend"
              @click="transact('bind')"
              >{{ t("bind") }}</NativeButton
            ></view
          ></view
        ><view class="directs"
          ><h3>
            {{ t("directs") }} <span>{{ wallet?.referrals?.length || 0 }}</span>
          </h3>
          <view v-if="!wallet?.referrals?.length" class="empty">{{
            connected ? t("empty") : t("connect")
          }}</view
          ><view
            v-for="r in wallet?.referrals"
            :key="r.address"
            class="direct-row"
            ><span :title="r.address">{{ short(r.address) }}</span
            ><strong>{{ amount(r.balance) }} RASUN</strong></view
          ></view
        >
      </section>
      <section
        v-if="['overview', 'mining'].includes(tab)"
        class="panel ranking-panel"
      >
        <view class="panel-title"
          ><view
            ><h2>{{ t("ranking") }}</h2>
            <p>{{ t("rankDesc") }}</p></view
          ><span class="live-badge"
            ><span class="live-dot"></span> ON-CHAIN</span
          ></view
        ><view class="table-scroll"
          ><table>
            <thead>
              <tr>
                <th scope="col">{{ t("rank") }}</th>
                <th scope="col">{{ t("wallet") }}</th>
                <th scope="col">{{ t("holdings") }}</th>
                <th scope="col">{{ t("zone") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in ranks" :key="r.address">
                <td>
                  <span :class="['rank-number', { top: r.rank <= 3 }]">{{
                    r.rank.toString().padStart(2, "0")
                  }}</span>
                </td>
                <td>
                  <span class="avatar">{{ r.address.slice(2, 4) }}</span
                  ><span :title="r.address">{{ short(r.address) }}</span
                  ><span
                    v-if="r.address.toLowerCase() === account.toLowerCase()"
                    class="you-dot"
                    >●</span
                  >
                </td>
                <td class="balance-cell">
                  {{ amount(r.balance) }} <small>RASUN</small>
                </td>
                <td>
                  <span :class="['zone', r.zone]">{{ t(r.zone) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <view v-if="!ranks.length" class="empty">{{
            error ? t("unavailable") : t("empty")
          }}</view></view
        ><view class="pagination"
          ><span>{{ t("zoneNote") }}</span
          ><view
            ><NativeButton
              :disabled="rankPage === 1 || loading"
              @click="pageRank(-1)"
              >← {{ t("previous") }}</NativeButton
            ><span>{{ rankPage }}</span
            ><NativeButton
              :disabled="rankPage * 10 >= rankTotal || loading"
              @click="pageRank(1)"
              >{{ t("next") }} →</NativeButton
            ></view
          ></view
        >
      </section>
      <section v-if="tab === 'records'" class="panel">
        <view class="panel-title"
          ><view
            ><view class="eyebrow small">YOUR ON-CHAIN JOURNEY</view>
            <h2>{{ t("records") }}</h2></view
          ><span class="live-badge">UTC+8</span></view
        ><view class="table-scroll"
          ><table>
            <thead>
              <tr>
                <th scope="col">{{ t("time") }}</th>
                <th scope="col">{{ t("kind") }}</th>
                <th scope="col">{{ t("value") }}</th>
                <th scope="col">{{ t("tx") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in events.filter((e) => e.name === 'Claimed')"
                :key="e.txHash + e.logIndex"
              >
                <td>{{ date(e.timestamp) }}</td>
                <td>{{ t(e.args.kind === "0" ? "mining" : "referral") }}</td>
                <td>{{ amount(e.args.amount, 6) }} RASUN</td>
                <td>
                  <a
                    v-if="config.explorer"
                    :href="config.explorer + '/tx/' + e.txHash"
                    target="_blank"
                    rel="noreferrer"
                    >{{ short(e.txHash) }} ↗</a
                  ><span v-else :title="e.txHash">{{ short(e.txHash) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <view
            v-if="!events.some((e) => e.name === 'Claimed')"
            class="empty"
            >{{ connected ? t("empty") : t("connect") }}</view
          ></view
        ><view class="pagination"
          ><span>{{ t("gas") }}</span
          ><view
            ><NativeButton :disabled="recordPage === 1" @click="pageRecords(-1)"
              >← {{ t("previous") }}</NativeButton
            ><span>{{ recordPage }}</span
            ><NativeButton
              :disabled="recordPage * 10 >= recordTotal"
              @click="pageRecords(1)"
              >{{ t("next") }} →</NativeButton
            ></view
          ></view
        >
      </section>
      <section v-if="tab === 'overview'" id="economics" class="economics">
        <view
          ><view class="eyebrow small">DESIGNED FOR THE LONG RUN</view>
          <h2>{{ t("model") }}</h2>
          <p>{{ t("modelDesc") }}</p>
          <view class="settlement-status"
            ><span class="live-dot"></span>{{ t("settlement") }} ·
            {{ settled ? t("settled") : t("waiting") }}</view
          ></view
        ><view class="emission-progress"
          ><view class="progress-label"
            ><span>{{ t("issued") }}</span
            ><strong data-testid="minted"
              >{{ amount(overview?.totalMinted) }} <small>RASUN</small></strong
            ></view
          ><view class="progress-track"
            ><view :style="{ width: progress + '%' }"></view></view
          ><view class="progress-bottom"
            ><span>{{ progress }}%</span
            ><span
              >{{ t("remaining") }}
              {{
                overview
                  ? amount(
                      String(
                        BigInt(overview.cap) - BigInt(overview.totalMinted),
                      ),
                      0,
                    )
                  : "—"
              }}</span
            ></view
          ></view
        >
      </section>
    </main>
    <footer>
      <view class="brand footer-brand"
        ><view class="brand-mark">R<span>↗</span></view
        >RASUN</view
      >
      <p>{{ t("footer") }}</p>
      <span>© {{ new Date().getFullYear() }} RASUN</span>
    </footer>
    <nav class="mobile-nav" aria-label="Mobile">
      <NativeButton
        v-for="(item, i) in ['overview', 'mining', 'referral', 'records']"
        :key="item"
        :class="{ active: tab === item }"
        @click="tab = item"
        ><span>{{ ["◈", "⌁", "⌘", "▤"][i] }}</span
        >{{ t(item) }}</NativeButton
      >
    </nav>
  </view>
</template>
<style src="../../style.css"></style>
