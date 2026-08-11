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

// ===== [TRAXNODE] 明细查询与冲销（用户侧脱敏 DTO / 管理员侧明文 DTO 物理隔离，零共享防串数据） =====

// AffRebateUserItem 用户侧返利明细行；InviteeUsername 已经 maskUsername 脱敏，明文不出后端。
type AffRebateUserItem struct {
	Id              int     `json:"id"`
	InviteeUsername string  `json:"invitee_username"`
	Money           float64 `json:"money"`
	RebateQuota     int     `json:"rebate_quota"`
	Status          int     `json:"status"`
	UnlockTime      int64   `json:"unlock_time"`
	CreateTime      int64   `json:"create_time"`
}

// getUsernamesByIds 批量取用户名（Unscoped 含软删用户：删号后明细仍可对账）；查不到的 id 缺键返回空串。
func getUsernamesByIds(ids []int) map[int]string {
	usernames := make(map[int]string, len(ids))
	if len(ids) == 0 {
		return usernames
	}
	var rows []struct {
		Id       int
		Username string
	}
	if err := DB.Unscoped().Model(&User{}).Select("id, username").Where("id IN ?", ids).Scan(&rows).Error; err != nil {
		common.SysError("aff rebate: failed to fetch usernames: " + err.Error())
		return usernames
	}
	for _, r := range rows {
		usernames[r.Id] = r.Username
	}
	return usernames
}

// GetUserAffRebateLogs 用户侧返利明细（倒序分页），并返回冻结中总额聚合（status=1 求和，供四统计卡「冻结中」）。
func GetUserAffRebateLogs(userId int, pageInfo *common.PageInfo) (items []*AffRebateUserItem, total int64, frozenTotal int64, err error) {
	if err = DB.Model(&AffRebateLog{}).Where("inviter_id = ?", userId).Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}
	var logs []*AffRebateLog
	if err = DB.Where("inviter_id = ?", userId).Order("id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&logs).Error; err != nil {
		return nil, 0, 0, err
	}
	inviteeIds := make([]int, 0, len(logs))
	for _, l := range logs {
		inviteeIds = append(inviteeIds, l.InviteeId)
	}
	usernames := getUsernamesByIds(inviteeIds)
	items = make([]*AffRebateUserItem, 0, len(logs))
	for _, l := range logs {
		items = append(items, &AffRebateUserItem{
			Id:              l.Id,
			InviteeUsername: maskUsername(usernames[l.InviteeId]),
			Money:           l.Money,
			RebateQuota:     l.RebateQuota,
			Status:          l.Status,
			UnlockTime:      l.UnlockTime,
			CreateTime:      l.CreateTime,
		})
	}
	if err = DB.Model(&AffRebateLog{}).Where("inviter_id = ? AND status = ?", userId, AffRebateStatusFrozen).
		Select("COALESCE(SUM(rebate_quota), 0)").Scan(&frozenTotal).Error; err != nil {
		return nil, 0, 0, err
	}
	return items, total, frozenTotal, nil
}

// AffInviteeItem 用户侧「邀请的用户」行；Username 已脱敏；ContributedQuota 口径=仅 status=2 已入账
// （冻结未入账不计、已冲销剔除，与 aff_history「冻结不计入/冲销双扣」语义对齐）。
type AffInviteeItem struct {
	Username         string `json:"username"`
	CreatedAt        int64  `json:"created_at"`
	ContributedQuota int64  `json:"contributed_quota"`
}

// GetUserAffInvitees 邀请的用户列表（Unscoped 含软删，与 aff_count「注册即计数」口径一致；total 兼作邀请人数）。
func GetUserAffInvitees(userId int, pageInfo *common.PageInfo) (items []*AffInviteeItem, total int64, err error) {
	if err = DB.Unscoped().Model(&User{}).Where("inviter_id = ?", userId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var invitees []struct {
		Id        int
		Username  string
		CreatedAt int64
	}
	if err = DB.Unscoped().Model(&User{}).Select("id, username, created_at").
		Where("inviter_id = ?", userId).Order("id desc").
		Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Scan(&invitees).Error; err != nil {
		return nil, 0, err
	}
	inviteeIds := make([]int, 0, len(invitees))
	for _, u := range invitees {
		inviteeIds = append(inviteeIds, u.Id)
	}
	contributed := make(map[int]int64, len(inviteeIds))
	if len(inviteeIds) > 0 {
		var sums []struct {
			InviteeId int
			QuotaSum  int64
		}
		if err = DB.Model(&AffRebateLog{}).
			Select("invitee_id, COALESCE(SUM(rebate_quota), 0) AS quota_sum").
			Where("inviter_id = ? AND invitee_id IN ? AND status = ?", userId, inviteeIds, AffRebateStatusCredited).
			Group("invitee_id").Scan(&sums).Error; err != nil {
			return nil, 0, err
		}
		for _, s := range sums {
			contributed[s.InviteeId] = s.QuotaSum
		}
	}
	items = make([]*AffInviteeItem, 0, len(invitees))
	for _, u := range invitees {
		items = append(items, &AffInviteeItem{
			Username:         maskUsername(u.Username),
			CreatedAt:        u.CreatedAt,
			ContributedQuota: contributed[u.Id],
		})
	}
	return items, total, nil
}

// AffRebateAdminItem 管理员侧返利明细行（明文用户名，管理员本有全量 PII）。
type AffRebateAdminItem struct {
	AffRebateLog
	InviterUsername   string `json:"inviter_username"`
	InviteeUsername   string `json:"invitee_username"`
	ReverseByUsername string `json:"reverse_by_username,omitempty"`
}

// AffRebateAdminQuery 管理员明细筛选参数（零值=不过滤）。
type AffRebateAdminQuery struct {
	InviterId int
	InviteeId int
	TradeNo   string
	Status    int
	Keyword   string // 关键词搜用户名（命中邀请人或被邀人任一侧）
}

// GetAllAffRebateLogs 管理员全量返利明细（明文 + 筛选 + 倒序分页）。
func GetAllAffRebateLogs(query *AffRebateAdminQuery, pageInfo *common.PageInfo) (items []*AffRebateAdminItem, total int64, err error) {
	q := DB.Model(&AffRebateLog{})
	if query.InviterId > 0 {
		q = q.Where("inviter_id = ?", query.InviterId)
	}
	if query.InviteeId > 0 {
		q = q.Where("invitee_id = ?", query.InviteeId)
	}
	if query.TradeNo != "" {
		q = q.Where("trade_no = ?", query.TradeNo)
	}
	if query.Status > 0 {
		q = q.Where("status = ?", query.Status)
	}
	if query.Keyword != "" {
		like := "%" + query.Keyword + "%"
		sub := DB.Unscoped().Model(&User{}).Select("id").Where("username LIKE ?", like)
		q = q.Where("inviter_id IN (?) OR invitee_id IN (?)", sub, sub)
	}
	if err = q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []*AffRebateLog
	if err = q.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	userIds := make([]int, 0, len(logs)*3)
	for _, l := range logs {
		userIds = append(userIds, l.InviterId, l.InviteeId)
		if l.ReverseBy != 0 {
			userIds = append(userIds, l.ReverseBy)
		}
	}
	usernames := getUsernamesByIds(userIds)
	items = make([]*AffRebateAdminItem, 0, len(logs))
	for _, l := range logs {
		items = append(items, &AffRebateAdminItem{
			AffRebateLog:      *l,
			InviterUsername:   usernames[l.InviterId],
			InviteeUsername:   usernames[l.InviteeId],
			ReverseByUsername: usernames[l.ReverseBy],
		})
	}
	return items, total, nil
}

// AffRebateStatusStat 单状态聚合（笔数 + 返利额度求和，供管理员页头概览徽章）。
type AffRebateStatusStat struct {
	Status int   `json:"status" gorm:"column:status"`
	Count  int64 `json:"count" gorm:"column:cnt"`
	Quota  int64 `json:"quota" gorm:"column:quota_sum"`
}

// GetAffRebateStatusStats 各状态计数与金额聚合（全库口径，不随筛选变化）。
func GetAffRebateStatusStats() ([]*AffRebateStatusStat, error) {
	var stats []*AffRebateStatusStat
	err := DB.Model(&AffRebateLog{}).
		Select("status, COUNT(*) AS cnt, COALESCE(SUM(rebate_quota), 0) AS quota_sum").
		Group("status").Order("status").Scan(&stats).Error
	return stats, err
}

// ReverseAffRebateLog 冲销一条返利记录（管理员操作，事务化 + 幂等）：
//   - status=1 冻结中：直接翻 3，零追讨（额度从未进 aff_quota）；
//   - status=2 已入账：翻 3 + 邀请人 aff_quota/aff_history 双扣（gorm.Expr 原子，允许负数）；
//   - status=3 已冲销：幂等返回 alreadyReversed=true，不重复扣减。
//
// 行锁读 + WHERE status=? 乐观锁双保险；与解冻任务竞态两序均安全（任一先行，另一方按新状态走对应分支）。
func ReverseAffRebateLog(id int, adminId int, reason string) (reversed *AffRebateLog, alreadyReversed bool, err error) {
	// ReverseReason varchar(255) 护栏：按 rune 截断，防超长备注写库失败
	if runes := []rune(reason); len(runes) > 255 {
		reason = string(runes[:255])
	}
	var l AffRebateLog
	deducted := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ?", id).First(&l).Error; err != nil {
			return err
		}
		if l.Status == AffRebateStatusReversed {
			alreadyReversed = true
			return nil
		}
		prevStatus := l.Status
		now := common.GetTimestamp()
		res := tx.Model(&AffRebateLog{}).Where("id = ? AND status = ?", l.Id, prevStatus).Updates(map[string]interface{}{
			"status":         AffRebateStatusReversed,
			"reverse_time":   now,
			"reverse_by":     adminId,
			"reverse_reason": reason,
		})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("返利记录状态已被并发变更，请刷新后重试")
		}
		if prevStatus == AffRebateStatusCredited {
			if err := tx.Model(&User{}).Where("id = ?", l.InviterId).Updates(map[string]interface{}{
				"aff_quota":   gorm.Expr("aff_quota - ?", l.RebateQuota),
				"aff_history": gorm.Expr("aff_history - ?", l.RebateQuota),
			}).Error; err != nil {
				return err
			}
			deducted = true
		}
		l.Status = AffRebateStatusReversed
		l.ReverseTime = now
		l.ReverseBy = adminId
		l.ReverseReason = reason
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if alreadyReversed {
		return &l, true, nil
	}
	if deducted {
		if err := InvalidateUserCache(l.InviterId); err != nil {
			common.SysError(fmt.Sprintf("aff rebate: failed to invalidate user cache %d: %s", l.InviterId, err.Error()))
		}
	}
	// 邀请人侧流水（全链路一体脱敏：被邀人名走 maskUsername）
	inviteeName, _ := GetUsernameById(l.InviteeId, false)
	if deducted {
		RecordLog(l.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户 %s 的充值返利 %s 已被冲销，并从返利余额扣回（订单号 %s）", maskUsername(inviteeName), logger.LogQuota(l.RebateQuota), l.TradeNo))
	} else {
		RecordLog(l.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户 %s 的冻结返利 %s 已被冲销（尚未入账，无追讨，订单号 %s）", maskUsername(inviteeName), logger.LogQuota(l.RebateQuota), l.TradeNo))
	}
	return &l, false, nil
}
