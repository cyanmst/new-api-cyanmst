package relay

// [TRAXNODE] Token task fetches must not expose the channel that ran the
// task. See .trellis/tasks/10-25-rc46-leak-hardening.

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVideoFetchByIDHidesChannelId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database := setupRelayChannelDB(t)
	require.NoError(t, database.AutoMigrate(&model.Task{}))
	// A non-Gemini channel skips the realtime fetch, so the generic TaskDto
	// response is built.
	require.NoError(t, database.Create(&model.Channel{Id: 42, Name: "hidden-upstream", Type: constant.ChannelTypeOpenAI}).Error)
	require.NoError(t, database.Create(&model.Task{
		TaskID: "task-hidden-channel", Platform: "document-parser", UserId: 7, ChannelId: 42,
		Status: model.TaskStatusInProgress, Progress: "50%",
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/video/generations/task-hidden-channel", nil)
	ctx.Params = gin.Params{{Key: "task_id", Value: "task-hidden-channel"}}
	ctx.Set("id", 7)

	respBody, taskErr := videoFetchByIDRespBodyBuilder(ctx)
	require.Nil(t, taskErr)
	var response map[string]any
	require.NoError(t, common.Unmarshal(respBody, &response))
	data := response["data"].(map[string]any)
	assert.Equal(t, "task-hidden-channel", data["task_id"])
	assert.EqualValues(t, 0, data["channel_id"])

	var stored model.Task
	require.NoError(t, database.Where("task_id = ?", "task-hidden-channel").First(&stored).Error)
	assert.Equal(t, 42, stored.ChannelId, "the stored task keeps its channel")
}

func TestVideoFetchByIDMissingAdaptorHidesChannelId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database := setupRelayChannelDB(t)
	require.NoError(t, database.AutoMigrate(&model.Task{}))
	require.NoError(t, database.Create(&model.Channel{Id: 4242, Name: "hidden-upstream", Type: constant.ChannelTypeOpenAI}).Error)
	require.NoError(t, database.Create(&model.Task{
		TaskID: "task-missing-adaptor", Platform: "trax-missing-plugin", UserId: 7, ChannelId: 4242,
		Status: model.TaskStatusInProgress, Progress: "50%",
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	// The OpenAI video path needs a task adaptor; this platform has none.
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/task-missing-adaptor", nil)
	ctx.Params = gin.Params{{Key: "task_id", Value: "task-missing-adaptor"}}
	ctx.Set("id", 7)

	_, taskErr := videoFetchByIDRespBodyBuilder(ctx)
	require.NotNil(t, taskErr)
	assert.Equal(t, "invalid_channel_id", taskErr.Code)
	assert.NotContains(t, taskErr.Message, "4242")
}
