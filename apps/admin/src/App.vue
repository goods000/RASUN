<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
const tab = ref("overview"),
  overview = ref<any>(null),
  config = ref<any>(null),
  health = ref<any>(null),
  ranking = ref<any[]>([]),
  events = ref<any[]>([]),
  wallet = ref<any>(null);
const search = ref(""),
  error = ref(""),
  queryError = ref(""),
  loading = ref(false),
  page = ref(1),
  total = ref(0),
  eventPage = ref(1),
  eventTotal = ref(0);
let timer: ReturnType<typeof setInterval>;
let generation = 0;
let queryGeneration = 0;
const tabs = [
  { key: "overview", label: "运行总览", icon: "◈" },
  { key: "users", label: "用户与排名", icon: "◉" },
  { key: "referrals", label: "邀请关系", icon: "⌘" },
  { key: "events", label: "链上事件", icon: "▤" },
  { key: "settlement", label: "发行与结算", icon: "⌁" },
];
function fmt(value: any, d = 4) {
  if (value == null) return "—";
  try {
    const b = BigInt(value);
    const whole = (b / 10n ** 18n).toLocaleString();
    const f = (b % 10n ** 18n)
      .toString()
      .padStart(18, "0")
      .slice(0, d)
      .replace(/0+$/, "");
    return whole + (f ? "." + f : "");
  } catch {
    return "—";
  }
}
function short(a: string) {
  return a ? a.slice(0, 8) + "…" + a.slice(-6) : "—";
}
async function api(p: string) {
  const r = await fetch("/api/" + p, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Error("服务不可用或查询参数无效");
  return r.json();
}
async function refresh() {
  const id = ++generation;
  loading.value = true;
  try {
    const [o, c, h, r, e] = await Promise.all([
      api("overview"),
      api("config"),
      api("health"),
      api(`ranking?page=${page.value}&limit=10`),
      api(`events?page=${eventPage.value}&limit=15`),
    ]);
    if (id !== generation) return;
    overview.value = o;
    config.value = c;
    health.value = h;
    ranking.value = r.items;
    total.value = r.total;
    events.value = e.items;
    eventTotal.value = e.total;
    error.value = "";
  } catch {
    if (id === generation)
      error.value = "链上服务暂不可用，请检查本地链、部署配置与 API。";
  } finally {
    if (id === generation) loading.value = false;
  }
}
async function query(value?: string) {
  const id = ++queryGeneration;
  if (value) search.value = value;
  wallet.value = null;
  queryError.value = "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(search.value)) {
    queryError.value = "请输入有效的 EVM 钱包地址";
    return;
  }
  try {
    const result = await api("wallet/" + search.value);
    if (id === queryGeneration) wallet.value = result;
  } catch {
    if (id === queryGeneration)
      queryError.value = "钱包查询失败，请检查地址校验和或链上服务";
  }
}
function date(ts: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts * 1000));
}
function turn(delta: number, isEvents = false) {
  if (isEvents) eventPage.value += delta;
  else page.value += delta;
  void refresh();
}
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 15000);
});
onUnmounted(() => {
  clearInterval(timer);
  generation++;
});
</script>
<template>
  <div class="admin-layout">
    <aside>
      <div class="admin-brand">
        <span>R↗</span>
        <div>RASUN<small>OPERATIONS CONSOLE</small></div>
      </div>
      <div class="aside-label">工作空间</div>
      <nav>
        <button
          v-for="item in tabs"
          :key="item.key"
          :aria-label="item.label"
          :class="{ active: tab === item.key }"
          @click="tab = item.key"
        >
          <span>{{ item.icon }}</span
          >{{ item.label }}<i v-if="tab === item.key">›</i>
        </button>
      </nav>
      <div class="aside-foot">
        <span class="status-dot"></span> 只读监控 · 钱包自托管<small
          >资产操作始终由链上合约执行</small
        >
      </div>
    </aside>
    <div class="admin-content">
      <header>
        <div class="breadcrumb">
          工作空间 <span>/</span> {{ tabs.find((x) => x.key === tab)?.label }}
        </div>
        <div class="header-right">
          <span class="network-tag">{{ config?.network || "未连接" }}</span
          ><span class="operator-avatar">R</span>
        </div>
      </header>
      <main>
        <div class="page-title">
          <div>
            <span class="overline">RASUN ECOSYSTEM</span>
            <h1>{{ tabs.find((x) => x.key === tab)?.label }}</h1>
            <p>链上数据，透明可见。所有时间均为 UTC+8。</p>
          </div>
          <button class="refresh" :disabled="loading" @click="refresh">
            ↻ {{ loading ? "读取中…" : "刷新数据" }}
          </button>
        </div>
        <div class="test-banner">
          ◇ 当前为{{
            config?.mode === "local" ? "本地开发" : "测试网"
          }}环境，使用测试预言机，不代表真实市场价格。管理后台不提供资产转移权限。
        </div>
        <div v-if="error" class="alert" role="alert">{{ error }}</div>
        <section
          v-if="tab === 'overview' || tab === 'settlement'"
          class="admin-stats"
        >
          <article>
            <div><span>累计已发行</span><i>◈</i></div>
            <strong data-testid="admin-supply">{{
              fmt(overview?.totalMinted)
            }}</strong
            ><small>RASUN · 累计铸造量</small>
          </article>
          <article>
            <div><span>流通总量</span><i>◎</i></div>
            <strong>{{ fmt(overview?.totalSupply) }}</strong
            ><small>RASUN · 扣除链上销毁</small>
          </article>
          <article>
            <div><span>累计销毁</span><i>♧</i></div>
            <strong>{{ fmt(overview?.totalBurned) }}</strong
            ><small>RASUN · 不恢复发行额度</small>
          </article>
          <article>
            <div><span>今日计划发行</span><i>↗</i></div>
            <strong>{{ fmt(overview?.todayEmission) }}</strong
            ><small>持币与推广各分配 50%</small>
          </article>
        </section>
        <section v-if="tab === 'overview'" class="overview-columns">
          <article class="admin-panel">
            <div class="panel-header">
              <h2>系统健康</h2>
              <span
                class="status-chip"
                :class="{
                  bad: health?.chain !== 'ready' || health?.index?.error,
                }"
                >{{
                  health?.chain === "ready" && !health?.index?.error
                    ? "正常运行"
                    : "等待服务"
                }}</span
              >
            </div>
            <dl>
              <div>
                <dt>网络</dt>
                <dd>
                  {{ config?.network || "—" }} / {{ config?.chainId || "—" }}
                </dd>
              </div>
              <div>
                <dt>事件索引区块</dt>
                <dd>{{ health?.index?.lastBlock ?? "—" }}</dd>
              </div>
              <div>
                <dt>索引状态</dt>
                <dd>{{ health?.index?.error || "已同步" }}</dd>
              </div>
              <div>
                <dt>价格参考</dt>
                <dd>
                  {{
                    overview?.priceStatus === "test"
                      ? "测试报价"
                      : overview?.priceStatus === "live"
                        ? "有效报价"
                        : "无效或过期，池卖出暂停"
                  }}
                </dd>
              </div>
              <div>
                <dt>当前卖出税率</dt>
                <dd>
                  {{
                    overview?.sellTax
                      ? Number(overview.sellTax) / 100 + "%"
                      : "—"
                  }}
                </dd>
              </div>
            </dl>
          </article>
          <article class="admin-panel">
            <div class="panel-header">
              <h2>合约部署</h2>
              <span class="muted">READ ONLY</span>
            </div>
            <div
              v-for="(a, key) in config?.addresses"
              :key="key"
              class="contract-row"
            >
              <span>{{ key }}</span
              ><a
                v-if="config?.explorer"
                :href="config.explorer + '/address/' + a"
                target="_blank"
                rel="noreferrer"
                >{{ short(String(a)) }} ↗</a
              ><code v-else :title="String(a)">{{ short(String(a)) }}</code>
            </div>
            <p class="panel-note">
              合约配置冻结后不可由后台改写。私钥不存储在后台。
            </p>
          </article>
        </section>
        <section
          v-if="tab === 'users' || tab === 'referrals'"
          class="admin-panel"
        >
          <div class="panel-header">
            <h2>{{ tab === "users" ? "钱包查询" : "直推关系查询" }}</h2>
            <span class="muted">ON-CHAIN IDENTITY</span>
          </div>
          <form class="search-row" @submit.prevent="query()">
            <input
              v-model="search"
              placeholder="输入钱包地址查询"
              aria-label="钱包地址查询"
            /><button class="purple-button" type="submit">查询钱包</button>
          </form>
          <div v-if="queryError" class="alert" role="alert">
            {{ queryError }}
          </div>
          <div v-if="wallet" class="wallet-detail">
            <div class="wallet-identity">{{ wallet.address }}</div>
            <div class="wallet-metrics">
              <div>
                <span>当前余额</span
                ><strong>{{ fmt(wallet.balance) }} <small>RASUN</small></strong>
              </div>
              <div>
                <span>持币算力</span><strong>{{ wallet.holdingPower }}</strong>
              </div>
              <div>
                <span>推广算力</span
                ><strong>{{ fmt(wallet.referralPower) }}</strong>
              </div>
              <div>
                <span>持币 / 推广待领</span
                ><strong
                  >{{ fmt(wallet.claimable.holding) }} /
                  {{ fmt(wallet.claimable.referral) }}</strong
                >
              </div>
            </div>
            <p>
              邀请人：<code>{{
                wallet.inviter === "0x0000000000000000000000000000000000000000"
                  ? "尚未绑定"
                  : wallet.inviter
              }}</code>
            </p>
            <h3>直属下级 · {{ wallet.referrals.length }}</h3>
            <div v-if="!wallet.referrals.length" class="admin-empty">
              暂无直推记录
            </div>
            <div
              v-for="r in wallet.referrals"
              :key="r.address"
              class="referral-row"
            >
              <code>{{ r.address }}</code
              ><span>{{ fmt(r.balance) }} RASUN</span>
            </div>
          </div>
        </section>
        <section
          v-if="tab === 'users' || tab === 'overview'"
          class="admin-panel"
        >
          <div class="panel-header">
            <h2>用户与排名</h2>
            <span class="muted">当前余额升序 · 收益以已结算快照为准</span>
          </div>
          <div class="admin-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">权重排名</th>
                  <th scope="col">钱包地址</th>
                  <th scope="col">当前持仓</th>
                  <th scope="col">持币区域</th>
                  <th scope="col">详情</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in ranking" :key="r.address">
                  <td>
                    <span class="rank-cell">{{ r.rank }}</span>
                  </td>
                  <td>
                    <code :title="r.address">{{ short(r.address) }}</code>
                  </td>
                  <td>{{ fmt(r.balance) }} <small>RASUN</small></td>
                  <td>
                    <span class="zone-chip">{{
                      (
                        {
                          public: "大众持币区",
                          optimal: "均衡持币区",
                          antiMonopoly: "反集中区",
                          whale: "高持仓区",
                        } as any
                      )[r.zone]
                    }}</span>
                  </td>
                  <td>
                    <button
                      class="link-button"
                      @click="
                        tab = 'users';
                        query(r.address);
                      "
                    >
                      查询 →
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!ranking.length" class="admin-empty">
              暂无合格持币地址
            </div>
          </div>
          <div class="admin-pagination">
            <span>共 {{ total }} 个合格地址 · 不含余额低于 1 枚的地址</span>
            <div>
              <button :disabled="page === 1" @click="turn(-1)">← 上一页</button
              ><span>{{ page }}</span
              ><button :disabled="page * 10 >= total" @click="turn(1)">
                下一页 →
              </button>
            </div>
          </div>
        </section>
        <section
          v-if="tab === 'events' || tab === 'overview'"
          class="admin-panel"
        >
          <div class="panel-header">
            <h2>链上事件</h2>
            <span class="muted">确认区块 · 幂等索引</span>
          </div>
          <div class="admin-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">时间（UTC+8）</th>
                  <th scope="col">事件</th>
                  <th scope="col">区块</th>
                  <th scope="col">交易哈希</th>
                  <th scope="col">参数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in events" :key="e.txHash + e.logIndex">
                  <td>{{ date(e.timestamp) }}</td>
                  <td>
                    <span class="event-chip">{{ e.name }}</span>
                  </td>
                  <td>#{{ e.blockNumber }}</td>
                  <td>
                    <a
                      v-if="config?.explorer"
                      :href="config.explorer + '/tx/' + e.txHash"
                      target="_blank"
                      rel="noreferrer"
                      >{{ short(e.txHash) }}</a
                    ><code v-else :title="e.txHash">{{ short(e.txHash) }}</code>
                  </td>
                  <td>
                    <details>
                      <summary>查看参数</summary>
                      <pre>{{ JSON.stringify(e.args, null, 2) }}</pre>
                    </details>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!events.length" class="admin-empty">暂无已索引事件</div>
          </div>
          <div class="admin-pagination">
            <span>共 {{ eventTotal }} 条事件</span>
            <div>
              <button :disabled="eventPage === 1" @click="turn(-1, true)">
                ← 上一页</button
              ><span>{{ eventPage }}</span
              ><button
                :disabled="eventPage * 15 >= eventTotal"
                @click="turn(1, true)"
              >
                下一页 →
              </button>
            </div>
          </div>
        </section>
        <section v-if="tab === 'settlement'" class="admin-panel">
          <div class="panel-header">
            <h2>发行与日结算</h2>
            <span class="status-chip">纯链上计算</span>
          </div>
          <dl>
            <div>
              <dt>累计发行上限</dt>
              <dd>{{ fmt(overview?.cap, 0) }} RASUN</dd>
            </div>
            <div>
              <dt>首个挖矿日（UTC+8 日编号）</dt>
              <dd>{{ overview?.startDay || "—" }}</dd>
            </div>
            <div>
              <dt>待结算日</dt>
              <dd>{{ overview?.nextDay || "—" }}</dd>
            </div>
            <div>
              <dt>当前日</dt>
              <dd>{{ overview?.currentDay || "—" }}</dd>
            </div>
            <div>
              <dt>正在处理的日</dt>
              <dd>
                {{
                  overview?.activeDay === "0"
                    ? "无"
                    : overview?.activeDay || "—"
                }}
              </dd>
            </div>
            <div>
              <dt>处理阶段 / 游标 / 参与数</dt>
              <dd>
                {{
                  overview?.settlement
                    ? `${overview.settlement.stage} / ${overview.settlement.cursor} / ${overview.settlement.count}`
                    : "无进行中的结算"
                }}
              </dd>
            </div>
            <div>
              <dt>无有效权重的未分配储备</dt>
              <dd>{{ fmt(overview?.unallocated) }} RASUN</dd>
            </div>
          </dl>
          <div class="test-banner">
            日结算由任意钱包分批触发。100 地址实测约 1.49 亿 Gas /
            日；本版本仅验证本地与测试网，不适合直接投入大规模主网。
          </div>
          <p class="panel-note">
            使用仓库 settle
            脚本继续结算。后台不保存签名账户，也不自动发送资产交易。
          </p>
        </section>
        <footer>RASUN · ON-CHAIN ECOSYSTEM <span>只读运营管理台</span></footer>
      </main>
    </div>
  </div>
</template>
<style src="./style.css"></style>
