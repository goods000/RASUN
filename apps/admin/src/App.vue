<script setup lang="ts">
import { onMounted, ref } from 'vue';
const apiStatus = ref('检测中');
onMounted(async () => { try { const r = await fetch('/api/health'); apiStatus.value = r.ok ? '服务正常' : '服务异常'; } catch { apiStatus.value = '后端未启动'; } });
</script>
<template><el-container style="min-height:100vh"><el-aside width="220px" style="background:#17233d;color:white;padding:24px"><h2>RASUN Admin</h2><p>总览</p><p>用户管理（待开发）</p><p>链上事件（待开发）</p></el-aside><el-main style="background:#f5f7fb;padding:32px"><h1>RASUN 运营管理台</h1><el-alert title="当前为项目骨架，不包含资产操作权限" type="info" show-icon :closable="false"/><el-card style="margin-top:24px"><template #header>服务状态</template><el-tag :type="apiStatus==='服务正常'?'success':'warning'">{{ apiStatus }}</el-tag><p>API: /api/health</p></el-card></el-main></el-container></template>
