package controller

// [TRAXNODE] Performance metrics are scoped to the caller's usable groups;
// admins see every group. See .trellis/tasks/10-25-rc46-leak-hardening.

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const perfHiddenModel = "trax-perf-hidden-model"

func setupPerfMetricsGroupTest(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled = previousRedis
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1,"trax_hidden":1}`))

	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	require.NoError(t, db.Create(&[]model.User{
		{Id: 11, Username: "trax_perf_default", AffCode: "trax_perf_a", Group: "default", Role: common.RoleCommonUser, Status: common.UserStatusEnabled},
		{Id: 12, Username: "trax_perf_vip", AffCode: "trax_perf_b", Group: "vip", Role: common.RoleCommonUser, Status: common.UserStatusEnabled},
	}).Error)

	now := time.Now().Unix()
	hour := now - now%3600 - 3600
	for _, row := range []model.PerfMetric{
		{ModelName: perfHiddenModel, Group: "default", BucketTs: hour, RequestCount: 10, SuccessCount: 10, TotalLatencyMs: 10000},
		{ModelName: perfHiddenModel, Group: "trax_hidden", BucketTs: hour, RequestCount: 10, SuccessCount: 0, TotalLatencyMs: 90000},
	} {
		require.NoError(t, model.UpsertPerfMetric(&row))
	}
}

func perfMetricsContext(userId int, role int, target string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, target, nil)
	if userId != 0 {
		ctx.Set("id", userId)
		ctx.Set("role", role)
	}
	return ctx, recorder
}

func callPerfMetricsHandler(t *testing.T, handler gin.HandlerFunc, userId int, role int, target string) map[string]any {
	t.Helper()
	ctx, recorder := perfMetricsContext(userId, role, target)
	handler(ctx)
	var response map[string]any
	require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &response))
	require.Equal(t, true, response["success"], recorder.Body.String())
	return response["data"].(map[string]any)
}

func TestPerfMetricsVisibleGroups(t *testing.T) {
	setupPerfMetricsGroupTest(t)

	visible := func(userId int, role int) []string {
		ctx, _ := perfMetricsContext(userId, role, "/api/perf-metrics/summary")
		return perfMetricsVisibleGroups(ctx)
	}
	assert.ElementsMatch(t, []string{"default"}, visible(0, 0), "anonymous visitors get the default usable groups")
	assert.ElementsMatch(t, []string{"default"}, visible(11, common.RoleCommonUser))
	assert.ElementsMatch(t, []string{"default", "vip"}, visible(12, common.RoleCommonUser), "a user also sees their own group")
	assert.ElementsMatch(t, []string{"default", "vip", "trax_hidden", "auto"}, visible(1, common.RoleAdminUser))
	assert.ElementsMatch(t, []string{"default", "vip", "trax_hidden", "auto"}, visible(1, common.RoleRootUser))

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{}`))
	groups := visible(0, 0)
	assert.NotNil(t, groups, "nil would mean every group to perfmetrics")
	assert.Empty(t, groups)
}

func TestPerfMetricsSummaryExcludesUnusableGroups(t *testing.T) {
	setupPerfMetricsGroupTest(t)

	modelSummary := func(data map[string]any) map[string]any {
		for _, item := range data["models"].([]any) {
			if item.(map[string]any)["model_name"] == perfHiddenModel {
				return item.(map[string]any)
			}
		}
		return nil
	}

	for _, caller := range []struct {
		name   string
		userId int
		role   int
	}{
		{"anonymous", 0, 0},
		{"common user", 11, common.RoleCommonUser},
	} {
		t.Run(caller.name, func(t *testing.T) {
			data := callPerfMetricsHandler(t, GetPerfMetricsSummary, caller.userId, caller.role, "/api/perf-metrics/summary")
			summary := modelSummary(data)
			require.NotNil(t, summary)
			assert.EqualValues(t, 100, summary["success_rate"], "trax_hidden failures are not counted")
			assert.EqualValues(t, 1000, summary["avg_latency_ms"])
		})
	}

	data := callPerfMetricsHandler(t, GetPerfMetricsSummary, 1, common.RoleAdminUser, "/api/perf-metrics/summary")
	summary := modelSummary(data)
	require.NotNil(t, summary)
	assert.EqualValues(t, 50, summary["success_rate"])
	assert.EqualValues(t, 5000, summary["avg_latency_ms"])
}

func TestPerfMetricsDetailExcludesUnusableGroups(t *testing.T) {
	setupPerfMetricsGroupTest(t)

	groupNames := func(data map[string]any) []string {
		names := []string{}
		groups, _ := data["groups"].([]any)
		for _, group := range groups {
			names = append(names, group.(map[string]any)["group"].(string))
		}
		return names
	}
	target := "/api/perf-metrics?model=" + perfHiddenModel

	for _, caller := range []struct {
		name   string
		userId int
		role   int
	}{
		{"anonymous", 0, 0},
		{"common user", 11, common.RoleCommonUser},
	} {
		t.Run(caller.name, func(t *testing.T) {
			data := callPerfMetricsHandler(t, GetPerfMetrics, caller.userId, caller.role, target)
			assert.Equal(t, []string{"default"}, groupNames(data))
			assert.EqualValues(t, 100, data["summary"].(map[string]any)["success_rate"])

			hidden := callPerfMetricsHandler(t, GetPerfMetrics, caller.userId, caller.role, target+"&group=trax_hidden")
			assert.Empty(t, groupNames(hidden))
			assert.Nil(t, hidden["summary"])
		})
	}

	data := callPerfMetricsHandler(t, GetPerfMetrics, 1, common.RoleAdminUser, target)
	assert.ElementsMatch(t, []string{"default", "trax_hidden"}, groupNames(data))
	assert.EqualValues(t, 50, data["summary"].(map[string]any)["success_rate"])
	hidden := callPerfMetricsHandler(t, GetPerfMetrics, 1, common.RoleAdminUser, target+"&group=trax_hidden")
	assert.Equal(t, []string{"trax_hidden"}, groupNames(hidden))
}
