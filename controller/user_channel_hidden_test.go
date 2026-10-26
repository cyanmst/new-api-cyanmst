package controller

// [TRAXNODE] User-facing endpoints must not expose channel ids; admin views
// keep them. See .trellis/tasks/10-25-rc46-leak-hardening.

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserLogViewsHideChannelId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Log{}, &model.QuotaData{}))
	now := time.Now().Unix()
	seedExportLogs(t, db, db, now)
	require.NoError(t, db.Create(&model.Log{
		UserId: 1, Username: "alice", CreatedAt: now - 30, Type: model.LogTypeConsume,
		ModelName: "gpt-a", ChannelId: 9, TokenId: 55, RequestId: "a-token",
	}).Error)
	query := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now+3600)

	t.Run("user list", func(t *testing.T) {
		listed := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, query)[0]
		require.Equal(t, true, listed["success"])
		items := listed["data"].(map[string]any)["items"].([]any)
		require.Len(t, items, 3)
		for _, item := range items {
			assert.EqualValues(t, 0, item.(map[string]any)["channel"])
			assert.Empty(t, item.(map[string]any)["channel_name"])
		}
	})

	t.Run("token lookup", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log/token", nil)
		ctx.Set("token_id", 55)
		GetLogByKey(ctx)
		var response map[string]any
		require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &response))
		require.Equal(t, true, response["success"])
		items := response["data"].([]any)
		require.Len(t, items, 1)
		assert.Equal(t, "a-token", items[0].(map[string]any)["request_id"])
		assert.EqualValues(t, 0, items[0].(map[string]any)["channel"])
	})

	t.Run("user export", func(t *testing.T) {
		own := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, query)
		require.Len(t, own, 4)
		for _, line := range own[:len(own)-1] {
			assert.EqualValues(t, 0, line["channel"])
		}
	})

	t.Run("admin views keep channel ids", func(t *testing.T) {
		listed := callLogHandler(t, GetAllLogs, 3, common.RoleAdminUser, query+"&username=alice")[0]
		require.Equal(t, true, listed["success"])
		channels := map[any]any{}
		for _, item := range listed["data"].(map[string]any)["items"].([]any) {
			channels[item.(map[string]any)["request_id"]] = item.(map[string]any)["channel"]
		}
		assert.EqualValues(t, 9, channels["a-1"])
		assert.EqualValues(t, 9, channels["a-token"])

		all := callLogHandler(t, ExportAllLogs, 3, common.RoleAdminUser, query+"&model_name=gpt-%25")
		exported := map[any]any{}
		for _, line := range all[:len(all)-1] {
			exported[line["request_id"]] = line["channel"]
		}
		assert.EqualValues(t, 9, exported["a-1"])
		assert.EqualValues(t, 9, exported["b-1"])
	})
}

func TestTaskDtoHidesChannelIdFromUsers(t *testing.T) {
	task := &model.Task{TaskID: "task_channel", Platform: "document-parser", ChannelId: 42}

	assert.Equal(t, 0, tasksToDto([]*model.Task{task}, false, common.RoleCommonUser)[0].ChannelId)
	assert.Equal(t, 42, tasksToDto([]*model.Task{task}, false, common.RoleAdminUser)[0].ChannelId)
	assert.Equal(t, 42, tasksToDto([]*model.Task{task}, false, common.RoleRootUser)[0].ChannelId)
	assert.Equal(t, 42, task.ChannelId, "the stored task keeps its channel")
}

func TestUserMidjourneyHidesChannelId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Midjourney{}))
	require.NoError(t, db.Create(&[]model.Midjourney{
		{UserId: 1, MjId: "mj-1", ChannelId: 42},
		{UserId: 1, MjId: "mj-2", ChannelId: 43},
		{UserId: 2, MjId: "mj-other", ChannelId: 44},
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/mj/self", nil)
	ctx.Set("id", 1)
	GetUserMidjourney(ctx)

	var response map[string]any
	require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &response))
	require.Equal(t, true, response["success"])
	items := response["data"].(map[string]any)["items"].([]any)
	require.Len(t, items, 2)
	for _, item := range items {
		assert.EqualValues(t, 0, item.(map[string]any)["channel_id"])
	}
	var stored model.Midjourney
	require.NoError(t, db.Where("mj_id = ?", "mj-1").First(&stored).Error)
	assert.Equal(t, 42, stored.ChannelId, "the stored task keeps its channel")
}

// callSelfStat runs GetLogsSelfStat as the given user and returns its data.
func callSelfStat(t *testing.T, username string, role int, query string) map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log/self/stat?"+query, nil)
	ctx.Set("username", username)
	ctx.Set("role", role)
	GetLogsSelfStat(ctx)
	var response map[string]any
	require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &response))
	require.Equal(t, true, response["success"], recorder.Body.String())
	return response["data"].(map[string]any)
}

func TestUserSelfStatIgnoresChannelFilter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	now := time.Now().Unix()
	require.NoError(t, db.Create(&[]model.Log{
		{UserId: 1, Username: "alice", CreatedAt: now - 3600, Type: model.LogTypeConsume, ModelName: "gpt-a", ChannelId: 9, Quota: 10},
		{UserId: 1, Username: "alice", CreatedAt: now - 20, Type: model.LogTypeConsume, ModelName: "gpt-a", ChannelId: 9, Quota: 5, PromptTokens: 7, CompletionTokens: 3},
		{UserId: 1, Username: "alice", CreatedAt: now - 10, Type: model.LogTypeConsume, ModelName: "gpt-a", ChannelId: 11, Quota: 100, PromptTokens: 40, CompletionTokens: 60},
		{UserId: 2, Username: "bob", CreatedAt: now - 15, Type: model.LogTypeConsume, ModelName: "gpt-a", ChannelId: 9, Quota: 1000, PromptTokens: 500},
	}).Error)
	window := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now+3600)

	unfiltered := callSelfStat(t, "alice", common.RoleCommonUser, window)
	assert.EqualValues(t, 115, unfiltered["quota"])
	assert.EqualValues(t, 2, unfiltered["rpm"])
	assert.EqualValues(t, 110, unfiltered["tpm"])

	for _, channel := range []string{"9", "1234"} {
		got := callSelfStat(t, "alice", common.RoleCommonUser, window+"&channel="+channel)
		assert.Equal(t, unfiltered, got, "channel=%s must not change a user's stats", channel)
	}

	// Admins keep the channel filter.
	byChannel := callSelfStat(t, "alice", common.RoleAdminUser, window+"&channel=9")
	assert.EqualValues(t, 15, byChannel["quota"])
	assert.EqualValues(t, 1, byChannel["rpm"])
	assert.EqualValues(t, 10, byChannel["tpm"])
	missing := callSelfStat(t, "alice", common.RoleAdminUser, window+"&channel=1234")
	assert.EqualValues(t, 0, missing["quota"])
	assert.EqualValues(t, 0, missing["rpm"])
	assert.EqualValues(t, 0, missing["tpm"])
}
