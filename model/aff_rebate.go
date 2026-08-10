package model

// [TRAXNODE] 邀请充值返利（一期，冻结期版）：被邀人每次充值成功，邀请人按实付金额比例获得返利。
// 默认先落冻结记录（status=1，不动 aff_quota），到期由解冻任务（controller/aff_rebate_task.go）批量入账；
// AffRebateFreezeDays=0 时走即时路径（向后兼容）。明细表以 trade_no 唯一索引兜底幂等；
// 冲销（status=3）由管理员冲销接口执行，status 三态为二期退款系统预埋扩展位。

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	AffRebateStatusFrozen   = 1 // 冻结中：已记账未入 aff_quota；冲销=直接翻 3，零追讨
	AffRebateStatusCredited = 2 // 已入账：解冻任务已将额度加进 aff_quota；冲销=翻 3 + aff_quota/aff_history 双扣
	AffRebateStatusReversed = 3 // 已冲销：终态
)

type AffRebateLog struct {
	Id            int     `json:"id"`
	TradeNo       string  `json:"trade_no" gorm:"type:varchar(255);uniqueIndex"` // 充值订单号，唯一索引保证同一订单只返一次
	InviterId     int     `json:"inviter_id" gorm:"index"`
	InviteeId     int     `json:"invitee_id" gorm:"index"`
	Money         float64 `json:"money"`        // 实付金额快照（美元）
	Percentage    float64 `json:"percentage"`   // 返利比例快照，日后调比例不影响旧账
	RebateQuota   int     `json:"rebate_quota"` // 返到 aff_quota 的额度
	Status        int     `json:"status" gorm:"type:int;default:1"`
	UnlockTime    int64   `json:"unlock_time" gorm:"index"` // 解冻时间（入账时按 AffRebateFreezeDays 快照；冻结天数=0 时等于 CreateTime）
	CreateTime    int64   `json:"create_time"`
	ReverseTime   int64   `json:"reverse_time"`                            // 冲销时间（审计字段，未冲销为 0）
	ReverseBy     int     `json:"reverse_by"`                              // 冲销操作管理员 id
	ReverseReason string  `json:"reverse_reason" gorm:"type:varchar(255)"` // 冲销原因备注（可空）
}

// maskUsername 用户名脱敏：不超过 2 字符取首字符加一星；3~5 字符取首尾各一加三星；6 字符及以上取前后各二加四星。
// 按 rune 处理防中文/emoji 截断；明文用户名不出后端，用户侧明细 API 与 RecordLog 文案共用。
func maskUsername(username string) string {
	runes := []rune(username)
	n := len(runes)
	switch {
	case n == 0:
		return "*"
	case n <= 2:
		return string(runes[:1]) + "*"
	case n <= 5:
		return string(runes[:1]) + "***" + string(runes[n-1:])
	default:
		return string(runes[:2]) + "****" + string(runes[n-2:])
	}
}

// isAffRebateGroupWhitelisted 判断邀请人分组是否在返利白名单内（逗号分隔，实时判定不快照）。
func isAffRebateGroupWhitelisted(group string) bool {
	for _, g := range strings.Split(common.AffRebateGroupWhitelist, ",") {
		if strings.TrimSpace(g) == group {
			return true
		}
	}
	return false
}

// ProcessAffRebate 处理一笔充值订单的邀请返利。
// 必须在充值事务提交「后」调用；内部任何错误只记日志，绝不反噬充值主流程。
// 四道闸（顺序执行，任一不过静默跳过）：比例为 0、被邀人无邀请人、邀请人不存在或状态非启用、邀请人分组不在白名单。
func ProcessAffRebate(inviteeId int, tradeNo string, money float64) {
	percentage := common.AffRebatePercentage
	if percentage <= 0 {
		return
	}
	if inviteeId == 0 || tradeNo == "" || money <= 0 {
		return
	}
	invitee, err := GetUserById(inviteeId, false)
	if err != nil {
		common.SysError(fmt.Sprintf("aff rebate: failed to get invitee %d (trade_no=%s): %s", inviteeId, tradeNo, err.Error()))
		return
	}
	if invitee.InviterId == 0 {
		return
	}
	// 第三道闸：邀请人不存在（含注销/软删）或状态非启用（封禁）→ 静默跳过
	inviter, err := GetUserById(invitee.InviterId, false)
	if err != nil {
		return
	}
	if inviter.Status != common.UserStatusEnabled {
		return
	}
	// 第四道闸：邀请人分组白名单（堵「特殊倍率×返利」折上折）
	if !isAffRebateGroupWhitelisted(inviter.Group) {
		return
	}
	// decimal 计算 + 饱和取整（计费加固不变量：禁裸 int(...)，aff_quota 为 MySQL INT32）
	rebateQuota, clamp := common.QuotaFromDecimalChecked(decimal.NewFromFloat(money).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		Mul(decimal.NewFromFloat(percentage)).
		Div(decimal.NewFromInt(100)))
	if clamp != nil {
		common.SysError(fmt.Sprintf("aff rebate: rebate quota clamped (trade_no=%s): %s", tradeNo, clamp.Error()))
	}
	if rebateQuota <= 0 {
		return
	}
	// 幂等预检：同一订单已返过直接跳过（webhook 重发的常规路径；并发窗口由唯一索引兜底）
	var count int64
	if err := DB.Model(&AffRebateLog{}).Where("trade_no = ?", tradeNo).Count(&count).Error; err != nil {
		common.SysError(fmt.Sprintf("aff rebate: failed to check trade_no %s: %s", tradeNo, err.Error()))
		return
	}
	if count > 0 {
		return
	}
	now := common.GetTimestamp()
	rebateLog := &AffRebateLog{
		TradeNo:     tradeNo,
		InviterId:   invitee.InviterId,
		InviteeId:   inviteeId,
		Money:       money,
		Percentage:  percentage,
		RebateQuota: rebateQuota,
		CreateTime:  now,
	}
	// 脱敏规则：邀请人侧文案用 maskUsername(被邀人)；被邀人侧文案不出现邀请人用户名
	maskedInvitee := maskUsername(invitee.Username)
	if freezeDays := common.AffRebateFreezeDays; freezeDays > 0 {
		// 冻结路径（默认）：仅落冻结记录，不动 aff_quota；到期由解冻任务入账
		rebateLog.Status = AffRebateStatusFrozen
		rebateLog.UnlockTime = now + int64(freezeDays)*86400
		if err := DB.Create(rebateLog).Error; err != nil {
			// 唯一索引冲突（并发重复回调）在此兜底，安全忽略；其余错误人工排查
			common.SysError(fmt.Sprintf("aff rebate: failed to create frozen rebate (trade_no=%s, inviter=%d): %s", tradeNo, invitee.InviterId, err.Error()))
			return
		}
		unlockDate := time.Unix(rebateLog.UnlockTime, 0).Format("2006-01-02")
		RecordLog(invitee.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户 %s 充值 $%.2f，获得返利 %s（比例 %.2f%%，冻结至 %s 解冻入账，订单号 %s）", maskedInvitee, money, logger.LogQuota(rebateQuota), percentage, unlockDate, tradeNo))
		RecordLog(inviteeId, LogTypeSystem, fmt.Sprintf("充值 $%.2f 为邀请人带来返利 %s（冻结至 %s，订单号 %s）", money, logger.LogQuota(rebateQuota), unlockDate, tradeNo))
		return
	}
	// 即时路径（AffRebateFreezeDays=0，向后兼容）：明细 INSERT 与额度 UPDATE 同一事务，
	// 并发重复触发时唯一索引使整个事务回滚，不会重复加额度
	rebateLog.Status = AffRebateStatusCredited
	rebateLog.UnlockTime = now
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(rebateLog).Error; err != nil {
			return err
		}
		return tx.Model(&User{}).Where("id = ?", invitee.InviterId).Updates(map[string]interface{}{
			"aff_quota":   gorm.Expr("aff_quota + ?", rebateQuota),
			"aff_history": gorm.Expr("aff_history + ?", rebateQuota),
		}).Error
	})
	if err != nil {
		common.SysError(fmt.Sprintf("aff rebate: failed to record rebate (trade_no=%s, inviter=%d): %s", tradeNo, invitee.InviterId, err.Error()))
		return
	}
	if err := InvalidateUserCache(invitee.InviterId); err != nil {
		common.SysError(fmt.Sprintf("aff rebate: failed to invalidate user cache %d: %s", invitee.InviterId, err.Error()))
	}
	RecordLog(invitee.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户 %s 充值 $%.2f，获得返利 %s（比例 %.2f%%，订单号 %s）", maskedInvitee, money, logger.LogQuota(rebateQuota), percentage, tradeNo))
	RecordLog(inviteeId, LogTypeSystem, fmt.Sprintf("充值 $%.2f 为邀请人带来返利 %s（订单号 %s）", money, logger.LogQuota(rebateQuota), tradeNo))
}

// HasFrozenAffRebate 是否仍存在冻结中的返利记录（解冻任务 Enabled 判定用：
// 返利功能关闭后，遗留的冻结记录仍需解冻入账）。
func HasFrozenAffRebate() bool {
	var id int
	if err := DB.Model(&AffRebateLog{}).Select("id").Where("status = ?", AffRebateStatusFrozen).Limit(1).Scan(&id).Error; err != nil {
		common.SysError("aff rebate: failed to check frozen rebates: " + err.Error())
		return false
	}
	return id > 0
}

// errAffRebateNotFrozen 表示记录已非冻结态（已被其他实例解冻，或已被人工冲销）。
var errAffRebateNotFrozen = errors.New("aff rebate log is not frozen")

// creditAffRebateLog 将一条冻结记录解冻入账：status 1→2 与 aff_quota/aff_history 双加同一事务。
// UPDATE 带 WHERE status=1 乐观锁，RowsAffected=0 即已被解冻/冲销（与冲销竞态两序均安全），
// 返回 errAffRebateNotFrozen 且不加额度——多实例重复跑不双加。
func creditAffRebateLog(l *AffRebateLog) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&AffRebateLog{}).
			Where("id = ? AND status = ?", l.Id, AffRebateStatusFrozen).
			Update("status", AffRebateStatusCredited)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errAffRebateNotFrozen
		}
		return tx.Model(&User{}).Where("id = ?", l.InviterId).Updates(map[string]interface{}{
			"aff_quota":   gorm.Expr("aff_quota + ?", l.RebateQuota),
			"aff_history": gorm.Expr("aff_history + ?", l.RebateQuota),
		}).Error
	})
}

// UnlockDueAffRebates 批量解冻到期返利（解冻任务入口）：每批不超过 batchSize，
// 以 id 递增 keyset 分页（失败记录不重查，天然防死循环），响应 ctx 取消。
// 单条失败只记日志继续，留到下一轮任务重试。
func UnlockDueAffRebates(ctx context.Context, batchSize int) (credited int, skipped int, failed int, err error) {
	if batchSize <= 0 {
		batchSize = 500
	}
	now := common.GetTimestamp()
	lastId := 0
	for {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return credited, skipped, failed, ctxErr
		}
		var logs []*AffRebateLog
		if err := DB.Where("status = ? AND unlock_time <= ? AND id > ?", AffRebateStatusFrozen, now, lastId).
			Order("id").Limit(batchSize).Find(&logs).Error; err != nil {
			return credited, skipped, failed, err
		}
		if len(logs) == 0 {
			return credited, skipped, failed, nil
		}
		for _, l := range logs {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return credited, skipped, failed, ctxErr
			}
			lastId = l.Id
			if err := creditAffRebateLog(l); err != nil {
				if errors.Is(err, errAffRebateNotFrozen) {
					skipped++
					continue
				}
				failed++
				common.SysError(fmt.Sprintf("aff rebate: failed to credit frozen rebate %d (trade_no=%s): %s", l.Id, l.TradeNo, err.Error()))
				continue
			}
			credited++
			if err := InvalidateUserCache(l.InviterId); err != nil {
				common.SysError(fmt.Sprintf("aff rebate: failed to invalidate user cache %d: %s", l.InviterId, err.Error()))
			}
			inviteeName, _ := GetUsernameById(l.InviteeId, false)
			RecordLog(l.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户 %s 的冻结返利 %s 已解冻入账（订单号 %s）", maskUsername(inviteeName), logger.LogQuota(l.RebateQuota), l.TradeNo))
		}
		if len(logs) < batchSize {
			return credited, skipped, failed, nil
		}
	}
}
