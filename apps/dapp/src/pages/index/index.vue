<script setup lang="ts">
import { ref } from 'vue';
const status = ref('未连接');
function connect() { status.value = '钱包功能待接入（当前仅为页面骨架）'; }
</script>
<template><view class="wrap"><text class="brand">RASUN</text><view class="hero"><text class="heading">链上雷闪经济模型</text><text class="desc">BSC · 持币算力 · 推广算力</text></view><view class="card"><text>钱包状态：{{status}}</text><button @click="connect">连接钱包（演示）</button></view><view class="card"><text>持币算力</text><text class="muted">等待合约与排名算法接入</text></view><view class="card"><text>推广算力</text><text class="muted">等待邀请关系与奖励合约接入</text></view></view></template>
<style scoped>.wrap{padding:36rpx}.brand{font-size:46rpx;font-weight:800;color:#ee9cf5}.hero{padding:70rpx 0;display:flex;flex-direction:column;gap:18rpx}.heading{font-size:48rpx;font-weight:700}.desc,.muted{color:#b8abc9;font-size:26rpx}.card{background:#292042;border-radius:24rpx;padding:32rpx;margin-bottom:24rpx;display:flex;flex-direction:column;gap:20rpx}button{background:#c55bdb;color:white;border:0;border-radius:30rpx}</style>
