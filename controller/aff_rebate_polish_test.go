package controller

// [TRAXNODE] Referral rebate polish (10-25-rc46-rebate-polish): the reversal
// writes exactly one structured audit row owned by the operator, and rebate
// errors carry message_key for the web console.

import (
	"bytes"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func callAffRebateHandler(t *testing.T, handler gin.HandlerFunc, method, path string, params gin.Params, operator *model.User, body string) (map[string]any, *gin.Context) {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, path, bytes.NewBufferString(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Params = params
	if operator != nil {
		ctx.Set("id", operator.Id)
		ctx.Set("role", operator.Role)
		ctx.Set("username", operator.Username)
	}
	handler(ctx)
	var response map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response, ctx
}

func TestReverseAffRebateStructuredAudit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.AffRebateLog{}, &model.Log{}, &model.AuditLog{}))

	operator := model.User{Username: "rebate-root", Password: "unused", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "op01"}
	inviter := model.User{Username: "rebate-inviter", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "inv1", AffQuota: 300000, AffHistoryQuota: 300000}
	require.NoError(t, db.Create(&operator).Error)
	require.NoError(t, db.Create(&inviter).Error)
	invitee := model.User{Username: "rebate-invitee", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "ive1", InviterId: inviter.Id}
	require.NoError(t, db.Create(&invitee).Error)
	frozen := model.AffRebateLog{TradeNo: "polish-frozen", InviterId: inviter.Id, InviteeId: invitee.Id, Money: 4, Percentage: 5, RebateQuota: 100000, Status: model.AffRebateStatusFrozen}
	credited := model.AffRebateLog{TradeNo: "polish-credited", InviterId: inviter.Id, InviteeId: invitee.Id, Money: 2, Percentage: 5, RebateQuota: 50000, Status: model.AffRebateStatusCredited}
	require.NoError(t, db.Create(&frozen).Error)
	require.NoError(t, db.Create(&credited).Error)

	reverse := func(t *testing.T, id string, body string) (map[string]any, *gin.Context) {
		return callAffRebateHandler(t, ReverseAffRebate, http.MethodPost, "/api/aff_rebate/"+id+"/reverse", gin.Params{{Key: "id", Value: id}}, &operator, body)
	}
	structuredRows := func(t *testing.T) []model.AuditLog {
		var rows []model.AuditLog
		require.NoError(t, db.Where("action = ?", "aff_rebate.reverse").Order("id").Find(&rows).Error)
		return rows
	}
	systemLogs := func(t *testing.T) int64 {
		var count int64
		require.NoError(t, db.Model(&model.Log{}).Where("user_id = ? AND type = ?", inviter.Id, model.LogTypeSystem).Count(&count).Error)
		return count
	}

	for _, tc := range []struct {
		name         string
		record       model.AffRebateLog
		body         string
		wantDeducted int
		wantReason   string
		wantAffQuota int
	}{
		{"frozen", frozen, `{"reason":"refund"}`, 0, "refund", 300000},
		{"credited", credited, `{}`, credited.RebateQuota, "-", 250000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := len(structuredRows(t))
			beforeSystem := systemLogs(t)
			id := common.Interface2String(tc.record.Id)
			response, ctx := reverse(t, id, tc.body)
			require.Equal(t, true, response["success"], response)
			assert.Equal(t, false, response["data"].(map[string]any)["already_reversed"])
			assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyAuditLogged), "generic fallback row must be suppressed")

			rows := structuredRows(t)
			require.Len(t, rows, before+1)
			row := rows[len(rows)-1]
			assert.Equal(t, operator.Id, row.UserId)
			assert.Equal(t, operator.Username, row.Username)
			assert.Equal(t, common.RoleRootUser, row.ActorRole)
			assert.Equal(t, model.AuditCategoryOperation, row.Category)
			require.NotNil(t, row.Other.Op)
			encoded, err := common.Marshal(row.Other.Op.Params)
			require.NoError(t, err)
			var params struct {
				RebateId      int    `json:"rebate_id"`
				TradeNo       string `json:"trade_no"`
				Quota         string `json:"quota"`
				Deducted      string `json:"deducted"`
				ReverseReason string `json:"reverse_reason"`
				Username      string `json:"username"`
				TargetUserId  int    `json:"target_user_id"`
			}
			require.NoError(t, common.Unmarshal(encoded, &params))
			var keys map[string]any
			require.NoError(t, common.Unmarshal(encoded, &keys))
			assert.ElementsMatch(t, []string{"rebate_id", "trade_no", "quota", "deducted", "reverse_reason", "username", "target_user_id"}, slices.Collect(maps.Keys(keys)))
			assert.Equal(t, tc.record.Id, params.RebateId)
			assert.Equal(t, tc.record.TradeNo, params.TradeNo)
			assert.Equal(t, logger.FormatQuota(tc.record.RebateQuota), params.Quota)
			assert.Equal(t, logger.FormatQuota(tc.wantDeducted), params.Deducted)
			assert.Equal(t, tc.wantReason, params.ReverseReason)
			assert.Equal(t, inviter.Username, params.Username)
			assert.Equal(t, inviter.Id, params.TargetUserId)
			assert.NotContains(t, string(encoded), invitee.Username)
			assert.NotContains(t, row.Content, invitee.Username)
			assert.Equal(t, fmt.Sprintf("Reversed referral rebate #%d of user %s (order %s, rebate %s, deducted %s, reason: %s)",
				tc.record.Id, inviter.Username, tc.record.TradeNo, params.Quota, params.Deducted, tc.wantReason), row.Content)
			require.NotNil(t, row.Other.AdminInfo)
			assert.Equal(t, operator.Id, row.Other.AdminInfo.AdminID)

			var user model.User
			require.NoError(t, db.First(&user, inviter.Id).Error)
			assert.Equal(t, tc.wantAffQuota, user.AffQuota)
			assert.Equal(t, beforeSystem+1, systemLogs(t), "inviter System flow unchanged")
		})
	}

	t.Run("already reversed writes no structured row", func(t *testing.T) {
		before := len(structuredRows(t))
		response, ctx := reverse(t, common.Interface2String(credited.Id), `{}`)
		require.Equal(t, true, response["success"])
		assert.Equal(t, true, response["data"].(map[string]any)["already_reversed"])
		assert.False(t, common.GetContextKeyBool(ctx, constant.ContextKeyAuditLogged))
		assert.Len(t, structuredRows(t), before)
		var user model.User
		require.NoError(t, db.First(&user, inviter.Id).Error)
		assert.Equal(t, 250000, user.AffQuota)
	})

	for _, tc := range []struct{ id, key string }{
		{"abc", "Invalid ID"},
		{"0", "Invalid ID"},
		{"999999", "Rebate record not found"},
	} {
		t.Run("error "+tc.id, func(t *testing.T) {
			before := len(structuredRows(t))
			response, ctx := reverse(t, tc.id, `{}`)
			assert.Equal(t, false, response["success"])
			assert.Equal(t, tc.key, response["message_key"])
			assert.False(t, common.GetContextKeyBool(ctx, constant.ContextKeyAuditLogged))
			assert.Len(t, structuredRows(t), before)
		})
	}
}

func TestAffRebateOptionValidationMessageKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct{ key, value, want string }{
		{"AffRebatePercentage", `"150"`, "Referral rebate percentage must be a number between 0 and 100"},
		{"AffRebatePercentage", `"-1"`, "Referral rebate percentage must be a number between 0 and 100"},
		{"AffRebatePercentage", `"abc"`, "Referral rebate percentage must be a number between 0 and 100"},
		{"AffRebateFreezeDays", `"-1"`, "Referral rebate freeze days must be a non-negative integer"},
		{"AffRebateFreezeDays", `"1.5"`, "Referral rebate freeze days must be a non-negative integer"},
	} {
		t.Run(tc.key+"="+tc.value, func(t *testing.T) {
			body := `{"key":"` + tc.key + `","value":` + tc.value + `}`
			response, _ := callAffRebateHandler(t, UpdateOption, http.MethodPut, "/api/option/", nil, nil, body)
			assert.Equal(t, false, response["success"])
			assert.Equal(t, tc.want, response["message_key"])
			assert.Equal(t, tc.want, response["message"])
		})
	}
}
