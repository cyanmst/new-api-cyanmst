package controller

// [TRAXNODE] 邀请返利解冻任务：定时将到期（unlock_time <= now）的冻结返利记录批量入账 aff_quota。
// 照 channelTestHandler 模式接入 SystemTask 基建（DB lease 多实例去重，每次运行落一条任务行）；
// 核心批处理逻辑在 model.UnlockDueAffRebates（model/aff_rebate.go）。

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const affRebateUnlockBatchSize = 500

// affRebateUnlockHandler runs the scheduled aff rebate unlock job.
type affRebateUnlockHandler struct{}

func (affRebateUnlockHandler) Type() string { return model.SystemTaskTypeAffRebateUnlock }

// Enabled 判定：返利功能开启，或仍存在冻结中记录（功能关闭后遗留的冻结记录仍需解冻入账）。
func (affRebateUnlockHandler) Enabled() bool {
	return common.AffRebatePercentage > 0 || model.HasFrozenAffRebate()
}

// Interval 固定 1 小时：解冻精度小时级足够，无需分钟级。
func (affRebateUnlockHandler) Interval() time.Duration { return time.Hour }

func (affRebateUnlockHandler) NewPayload() any { return nil }

// affRebateUnlockResult 单次运行统计：credited=解冻入账、skipped=已被他方处理（并发解冻/人工冲销）、failed=失败待下轮重试。
type affRebateUnlockResult struct {
	Credited int `json:"credited"`
	Skipped  int `json:"skipped"`
	Failed   int `json:"failed"`
}

func (affRebateUnlockHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	credited, skipped, failed, err := model.UnlockDueAffRebates(ctx, affRebateUnlockBatchSize)
	result := affRebateUnlockResult{Credited: credited, Skipped: skipped, Failed: failed}
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, result, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, result, nil)
}
