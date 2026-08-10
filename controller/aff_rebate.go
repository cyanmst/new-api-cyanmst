package controller

// [TRAXNODE] 邀请充值返利明细与管理接口（配套 model/aff_rebate.go）：
// 用户侧 ×2 挂 selfRoute（对方用户名一律后端 maskUsername 脱敏后下发，明文不出后端）；
// 管理员侧 ×2 挂 /api/aff_rebate（AdminAuth，明文明细 + 冲销执行，与用户侧物理隔离）。

import (
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

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
		common.ApiErrorMsg(c, "无效的返利记录 ID")
		return
	}
	req := ReverseAffRebateRequest{}
	_ = c.ShouldBindJSON(&req) // 原因选填，空请求体容忍
	rebateLog, alreadyReversed, err := model.ReverseAffRebateLog(id, c.GetInt("id"), req.Reason)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !alreadyReversed {
		// 管理操作审计：落邀请人日志流（LogTypeManage + admin_info）；文案不含被邀人用户名（脱敏铁律）
		content := fmt.Sprintf("管理员冲销邀请返利记录 #%d（订单号 %s，返利 %s）", rebateLog.Id, rebateLog.TradeNo, logger.LogQuota(rebateLog.RebateQuota))
		if rebateLog.ReverseReason != "" {
			content += fmt.Sprintf("，原因：%s", rebateLog.ReverseReason)
		}
		model.RecordLogWithAdminInfo(rebateLog.InviterId, model.LogTypeManage, content, auditOperatorInfo(c))
	}
	common.ApiSuccess(c, gin.H{
		"already_reversed": alreadyReversed,
		"item":             rebateLog,
	})
}
