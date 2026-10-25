package controller

// [TRAXNODE] 邀请充值返利明细与管理接口（配套 model/aff_rebate.go）：
// 用户侧 ×2 挂 selfRoute（对方用户名一律后端 maskUsername 脱敏后下发，明文不出后端）；
// 管理员侧 ×2 挂 /api/aff_rebate（AdminAuth，明文明细 + 冲销执行，与用户侧物理隔离）。

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// [TRAXNODE] English fallback for the reversal audit row; the web console renders
// the localized text from AUDIT_TEMPLATES['aff_rebate.reverse'].
func init() {
	auditContentTemplates["aff_rebate.reverse"] = "Reversed referral rebate #${rebate_id} of user ${username} (order ${trade_no}, rebate ${quota}, deducted ${deducted}, reason: ${reverse_reason})"
}

// GetUserAffRebates 用户侧返利明细（时间/来源用户名【脱敏】/实付/返利/状态），响应附 frozen_total 聚合（四统计卡「冻结中」取数）。
func GetUserAffRebates(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	items, total, frozenTotal, err := model.GetUserAffRebateLogs(userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"page":         pageInfo.GetPage(),
		"page_size":    pageInfo.GetPageSize(),
		"total":        total,
		"items":        items,
		"frozen_total": frozenTotal,
	})
}

// GetUserAffInvitees 用户侧「邀请的用户」列表（用户名【脱敏】/注册时间/累计贡献返利），total 兼作邀请人数。
func GetUserAffInvitees(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.GetUserAffInvitees(userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// GetAllAffRebates 管理员全量返利明细（明文 + 筛选：inviter_id/invitee_id/trade_no/status/keyword），
// 响应附各状态聚合统计（全库口径，供页头概览徽章）。
func GetAllAffRebates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := &model.AffRebateAdminQuery{
		TradeNo: c.Query("trade_no"),
		Keyword: c.Query("keyword"),
	}
	if v, err := strconv.Atoi(c.Query("inviter_id")); err == nil {
		query.InviterId = v
	}
	if v, err := strconv.Atoi(c.Query("invitee_id")); err == nil {
		query.InviteeId = v
	}
	if v, err := strconv.Atoi(c.Query("status")); err == nil {
		query.Status = v
	}
	items, total, err := model.GetAllAffRebateLogs(query, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, err := model.GetAffRebateStatusStats()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
		"total":     total,
		"items":     items,
		"stats":     stats,
	})
}

// ReverseAffRebateRequest 冲销请求体（原因选填，存审计列并落日志）。
type ReverseAffRebateRequest struct {
	Reason string `json:"reason"`
}

// ReverseAffRebate 冲销执行（事务化 + 幂等）：status=1 冻结中翻 3 零追讨；
// status=2 已入账翻 3 + aff_quota/aff_history 双扣（允许负数）；已冲销幂等返回。
func ReverseAffRebate(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid ID") // [TRAXNODE] reuse upstream key
		return
	}
	req := ReverseAffRebateRequest{}
	_ = c.ShouldBindJSON(&req) // 原因选填，空请求体容忍
	rebateLog, alreadyReversed, deducted, err := model.ReverseAffRebateLog(id, c.GetInt("id"), req.Reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !alreadyReversed {
		// [TRAXNODE] One structured audit row owned by the operator (target_user_id = inviter);
		// recordManageAuditFor marks the request so finishAdminAudit skips the generic row.
		// Repeat/failed requests fall through to the generic middleware row.
		// The invitee is deliberately left out (traceable via trade_no).
		// Param names follow the audit detail dialog: `username` is shown as the target,
		// and the record id is kept out of `id` so it is not mistaken for the target id.
		// `reverse_reason` (not `reason`) keeps the detail label from colliding with the
		// upstream user.binding_bind param of the same name.
		reason := rebateLog.ReverseReason
		if reason == "" {
			reason = "-"
		}
		deductedQuota := 0
		if deducted {
			deductedQuota = rebateLog.RebateQuota
		}
		inviterName, _ := model.GetUsernameById(rebateLog.InviterId, false)
		recordManageAuditFor(c, rebateLog.InviterId, "aff_rebate.reverse", map[string]any{
			"rebate_id":      rebateLog.Id,
			"trade_no":       rebateLog.TradeNo,
			"quota":          logger.FormatQuota(rebateLog.RebateQuota),
			"deducted":       logger.FormatQuota(deductedQuota),
			"reverse_reason": reason,
			"username":       inviterName,
		})
	}
	common.ApiSuccess(c, gin.H{
		"already_reversed": alreadyReversed,
		"item":             rebateLog,
	})
}
