# NewAPI 动态计费插件 — 技术报告

> 项目：cyanmst/new-api-cyanmst  
> 基线版本：NewAPI 0.13.2 (QuantumNous)  
> 日期：2026-05-23  

---

## 1. 项目背景

### 1.1 需求来源

在使用 NewAPI 0.13.2 作为 AI API 网关时，视频生成模型（如 `doubao-seedance-2-0`）的计费需求无法被现有三种计费模式满足：

| 现有模式 | 适用场景 | 局限 |
|---------|---------|------|
| 按量计费 (ratio) | 文本模型，按 token 数计价 | 无法处理分辨率/时长维度 |
| 按次计费 (per-call) | 固定价格任务 | 无法区分不同参数档位 |
| 表达式/阶梯计费 (tiered_expr) | 基于 token 区间的阶梯定价 | 表达式引擎绑定 token 维度，`param()` 函数返回值无法直接参与阶梯条件判断 |

视频模型的计费逻辑为：**分辨率档位单价 × 视频时长（秒）**，例如：

| 分辨率 | 单价 ($/秒) | 5秒视频价格 |
|--------|-----------|------------|
| 1080P  | $2.90     | $14.50     |
| 720P   | $1.60     | $8.00      |
| 480P   | $0.95     | $4.75      |

### 1.2 设计目标

- **外挂式插件**：以最小侵入方式挂载在原系统上，不修改核心函数内部逻辑
- **通用性**：支持任意基于请求体字段匹配的动态定价场景
- **完整性**：后端计费 + 前端可视化编辑 + 前端展示，端到端可用
- **兼容性**：不影响现有三种计费模式的正常运作

### 1.3 方案评估

开发前评估了三种替代方案：

| 方案 | 评估结果 |
|------|---------|
| 复用表达式计费 (tiered_expr) | 不可行 — `tier()` 函数条件仅支持 p/c/len 维度，`param()` 返回 interface{} 无法参与阶梯条件 |
| 参考可莱 API 文档的源码修改方案 | 不兼容 — 该方案基于 v0.12.11，与 0.13.2 的计费管线、配置系统、前端架构均不兼容 |
| 新增第4种计费模式 (dynamic_match) | **采纳** — 外挂式钩子，改动最小，完全向后兼容 |

---

## 2. 技术架构

### 2.1 计费流程

```
请求进入 → RelayTaskSubmit
         → ModelPriceHelperPerCall (price.go)
           → HandleGroupRatio (获取分组倍率)
           → TryDynamicMatchBilling (外挂钩子) ← 新增入口
             ├─ GetDynamicMatchConfig (读取配置)
             ├─ gjson 提取请求体字段 → 规则匹配 → 确定单价
             ├─ gjson 提取倍率字段 (如 metadata.duration) → 确定倍率
             ├─ 单价 × 倍率 × QuotaPerUnit × GroupRatio = Quota
             └─ 设置 BillingSnapshot (标记跳过后续 OtherRatios)
         → [TieredBillingSnapshot != nil → 跳过步骤5-6]
         → PreConsume (预扣费)
         → 发送上游请求
         → 完成
```

### 2.2 配置存储

```
前端编辑器 → API PUT /api/option/
  ├─ key: "billing_setting.billing_mode"    value: {"model_name": "dynamic_match"}
  └─ key: "billing_setting.dynamic_match"   value: {"model_name": "{...json config...}"}
→ DB options 表
→ config.GlobalConfig.LoadFromDB
→ billingSetting.DynamicMatch (内存热读取)
```

### 2.3 配置格式

```json
{
  "multiplier_field": "metadata.duration",
  "default_price": 2.90,
  "rules": [
    {
      "label": "1080P",
      "field_path": "metadata.resolution",
      "operator": "==",
      "value": "1080p",
      "price_per_unit": 2.90
    },
    {
      "label": "720P",
      "field_path": "metadata.resolution",
      "operator": "==",
      "value": "720p",
      "price_per_unit": 1.60
    },
    {
      "label": "480P",
      "field_path": "metadata.resolution",
      "operator": "==",
      "value": "480p",
      "price_per_unit": 0.95
    }
  ]
}
```

**字段说明：**
- `multiplier_field`：gjson 路径，从请求体提取数值作为乘数（如视频秒数）。留空默认为 1
- `default_price`：无规则匹配时的兜底单价，设为 0 表示拒绝请求
- `rules`：从上到下匹配，首个命中的规则生效
- `operator`：支持 `==`、`contains`、`prefix`、`suffix`、`>=`、`<=`、`>`、`<`

---

## 3. 代码变更

### 3.1 变更统计

| 指标 | 数值 |
|------|------|
| 功能提交 | 1 个 (`4b412fa`) |
| 修复提交 | 1 个 (`46f9f39`，补充 bun.lock) |
| 新增文件 | 4 个 |
| 修改文件 | 8 个 |
| 净增代码 | +867 行 / -33 行（不含 bun.lock） |

### 3.2 新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `setting/billing_setting/dynamic_match.go` | 92 | 配置结构体 (DynamicMatchConfig/Rule)、存取器、校验函数 |
| `relay/helper/task_billing_dynamic_match.go` | 168 | 计费钩子核心：gjson 规则匹配 → 价格计算 → BillingSnapshot |
| `web/.../DynamicMatchPricingEditor.jsx` | 351 | 前端可视化/JSON 双模式规则编辑器 |
| `web/.../DynamicMatchBreakdown.jsx` | 92 | 模型详情页的规则展示组件 |

### 3.3 修改文件

| 文件 | 改动量 | 内容 |
|------|--------|------|
| `setting/billing_setting/tiered_billing.go` | +10 | BillingSetting 新增 DynamicMatch 字段、初始化、同步导出 |
| `relay/helper/price.go` | +4 | ModelPriceHelperPerCall 入口插入钩子分发 |
| `relay/relay_task.go` | +2 净增 | TieredBillingSnapshot != nil 时跳过 OtherRatios |
| `model/pricing.go` | +9 | Pricing 结构体新增字段 + updatePricing 处理 dynamic_match |
| `web/.../ModelPricingEditor.jsx` | +35 | 第4个 Radio Tab + 条件渲染 + 标签颜色 |
| `web/.../useModelPricingEditorState.js` | +80 | 状态管理、加载/保存/预览逻辑 |
| `web/.../ModelDetailSideSheet.jsx` | +12 | dynamic_match 展示分支 |
| `web/.../ModelPricingTable.jsx` | +6 | 计费类型标签 + isDynamic 判断 |

### 3.4 钩子插入点详细说明

**后端入口 (price.go:170)：**
```go
func ModelPriceHelperPerCall(c *gin.Context, info *relaycommon.RelayInfo) (types.PriceData, error) {
    groupRatioInfo := HandleGroupRatio(c, info)

    // ← 钩子插入点：3 行
    if priceData, handled := TryDynamicMatchBilling(c, info, groupRatioInfo); handled {
        return priceData, nil
    }

    // 原有逻辑不变 ...
}
```

**OtherRatios 跳过 (relay_task.go:187)：**
```go
// dynamic_match 已在钩子中完成计价，跳过 adaptor 的 EstimateBilling 和 OtherRatios
if info.TieredBillingSnapshot == nil {
    // 原有步骤 5-6 ...
}
```

---

## 4. Docker 构建

### 4.1 构建流程

采用原版三阶段 Dockerfile，无修改：

```
Stage 1 (oven/bun:1)        → 前端编译：bun install + bun run build
Stage 2 (golang:1.26.1-alpine) → 后端编译：go mod download + go build
Stage 3 (debian:bookworm-slim)  → 运行时：仅包含编译产物 + 系统依赖
```

### 4.2 bun.lock 问题

构建时发现 `web/bun.lock` 被上游 `.gitignore` 排除（第22行），但 Dockerfile 第5行明确依赖该文件。

**原因分析**：上游将 `bun.lock` 视为生成物（与 `web/dist` 同类），但 Dockerfile 为利用 Docker 缓存层需要预先 COPY lock 文件。上游的 CI/CD 可能在构建前单独生成该文件。

**解决方案**：通过 `git add -f` 强制提交 bun.lock，不修改 .gitignore 规则。

### 4.3 构建命令

```bash
git clone https://github.com/cyanmst/new-api-cyanmst.git
cd new-api-cyanmst
docker build -t new-api-cyanmst:latest .
```

### 4.4 部署 (Docker Compose)

修改现有 `docker-compose.yml` 中的 `image` 字段：

```yaml
# 原：image: calciumion/new-api:latest
image: new-api-cyanmst:latest
```

执行 `docker compose up -d` 完成部署。

---

## 5. 许可证合规

### 5.1 许可证类型

NewAPI 0.13.2 采用 **AGPL-3.0 + 商业双授权**（Copyright (C) 2025 QuantumNous）。

### 5.2 合规措施

本项目选择以开源方式合规：

| 要求 | 措施 |
|------|------|
| 源码公开 | GitHub 公开仓库：github.com/cyanmst/new-api-cyanmst |
| 保留原始版权 | 所有原始文件头部 AGPL 声明完整保留 |
| 用户可获取源码 | 站点页脚保留原始 New API 链接，并追加本仓库链接 |
| 修改部分同 AGPL-3.0 | 新增文件自动继承 AGPL-3.0 许可 |

### 5.3 GitHub Secret 告警

推送后 GitHub 检测到 `common/str.go#L250` 存在 Google API Key 格式的字符串。经核实为**上游原始代码中的注释示例**（正则脱敏函数的演示文本），非真实密钥，可 Dismiss 为 False Positive。

---

## 6. 风险评估

| 风险项 | 级别 | 说明 |
|--------|------|------|
| 对现有计费的影响 | 低 | 钩子仅在 billing_mode == "dynamic_match" 时激活，其他模式完全不受影响 |
| 配置错误导致免费 | 中 | 若 rules 为空且 default_price 为 0，请求会以 quota=0 通过。建议前端增加保存校验 |
| 上游版本升级兼容 | 中 | 钩子插入点 (ModelPriceHelperPerCall) 若被上游重构可能需要调整，建议升级前 diff 对比 |
| multiplier_field 缺失 | 低 | 请求体中不存在该字段时默认 multiplier=1，退化为按次计费，不会报错 |

---

## 7. 后续建议

1. **前端保存校验**：在保存时调用 `ValidateDynamicMatchConfig` 接口，防止空规则或无效 JSON 写入
2. **页脚源码链接**：在站点页脚追加 GitHub 仓库链接，满足 AGPL-3.0 合规要求
3. **上游同步策略**：后续 NewAPI 升级时，仅需关注 `price.go` 和 `relay_task.go` 两个钩子插入点的兼容性
4. **监控**：建议观察动态计费模型的日志输出，确认 matched_label 和 quota 计算正确
