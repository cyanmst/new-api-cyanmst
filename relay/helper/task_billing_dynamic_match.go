package helper

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// TryDynamicMatchBilling is the external hook for per-call billing.
// It checks whether the model uses "dynamic_match" mode and, if so,
// computes PriceData + BillingSnapshot so that the caller can skip
// the default ratio/per-call path entirely.
//
// Returns (priceData, handled). When handled==true, the caller MUST
// use the returned PriceData and NOT fall through to default billing.
func TryDynamicMatchBilling(c *gin.Context, info *relaycommon.RelayInfo, groupRatioInfo types.GroupRatioInfo) (types.PriceData, bool) {
	cfg := billing_setting.GetDynamicMatchConfig(info.OriginModelName)
	if cfg == nil {
		return types.PriceData{}, false
	}

	body := readRequestBody(c)

	matchedPrice, matchedLabel := matchRule(cfg, body)

	multiplier := 1.0
	if cfg.MultiplierField != "" && len(body) > 0 {
		result := gjson.GetBytes(body, cfg.MultiplierField)
		if result.Exists() {
			if v := toFloat64(result); v > 0 {
				multiplier = v
			}
		}
	}

	// $price * multiplier → quota (same formula as per-call billing)
	totalPrice := matchedPrice * multiplier
	quotaBeforeGroup := totalPrice * common.QuotaPerUnit
	quota := billingexpr.QuotaRound(quotaBeforeGroup * groupRatioInfo.GroupRatio)

	freeModel := false
	if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
		if groupRatioInfo.GroupRatio == 0 || totalPrice == 0 {
			quota = 0
			freeModel = true
		}
	}

	// Build a BillingSnapshot so downstream (relay_task, settlement) knows
	// this was dynamic_match and skips OtherRatios / token re-calculation.
	snap := &billingexpr.BillingSnapshot{
		BillingMode:               billing_setting.BillingModeDynamicMatch,
		ModelName:                 info.OriginModelName,
		GroupRatio:                groupRatioInfo.GroupRatio,
		EstimatedQuotaBeforeGroup: quotaBeforeGroup,
		EstimatedQuotaAfterGroup:  quota,
		EstimatedTier:             matchedLabel,
		QuotaPerUnit:              common.QuotaPerUnit,
	}
	info.TieredBillingSnapshot = snap

	priceData := types.PriceData{
		FreeModel:      freeModel,
		ModelPrice:     totalPrice,
		UsePrice:       true,
		Quota:          quota,
		GroupRatioInfo: groupRatioInfo,
	}

	return priceData, true
}

// matchRule evaluates rules top-to-bottom and returns (pricePerUnit, label).
func matchRule(cfg *billing_setting.DynamicMatchConfig, body []byte) (float64, string) {
	if len(body) == 0 {
		if cfg.DefaultPrice > 0 {
			return cfg.DefaultPrice, "default"
		}
		return 0, "default"
	}
	for _, rule := range cfg.Rules {
		result := gjson.GetBytes(body, rule.FieldPath)
		if !result.Exists() {
			continue
		}
		fieldVal := strings.TrimSpace(result.String())
		if evalCondition(rule.Operator, fieldVal, rule.Value) {
			return rule.PricePerUnit, rule.Label
		}
	}
	return cfg.DefaultPrice, "default"
}

func evalCondition(op, fieldVal, ruleVal string) bool {
	ruleVal = strings.TrimSpace(ruleVal)
	switch op {
	case "==":
		return strings.EqualFold(fieldVal, ruleVal)
	case "contains":
		return strings.Contains(strings.ToLower(fieldVal), strings.ToLower(ruleVal))
	case "prefix":
		return strings.HasPrefix(strings.ToLower(fieldVal), strings.ToLower(ruleVal))
	case "suffix":
		return strings.HasSuffix(strings.ToLower(fieldVal), strings.ToLower(ruleVal))
	case ">=", "<=", ">", "<":
		fv, err1 := strconv.ParseFloat(fieldVal, 64)
		rv, err2 := strconv.ParseFloat(ruleVal, 64)
		if err1 != nil || err2 != nil {
			return false
		}
		switch op {
		case ">=":
			return fv >= rv
		case "<=":
			return fv <= rv
		case ">":
			return fv > rv
		case "<":
			return fv < rv
		}
	}
	return false
}

func readRequestBody(c *gin.Context) []byte {
	if c == nil || c.Request == nil {
		return nil
	}
	ct := c.Request.Header.Get("Content-Type")
	if !isJSONContentType(ct) {
		return nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil
	}
	b, _ := storage.Bytes()
	return b
}

func toFloat64(r gjson.Result) float64 {
	switch r.Type {
	case gjson.Number:
		return r.Float()
	case gjson.String:
		f, err := strconv.ParseFloat(strings.TrimSpace(r.Str), 64)
		if err != nil {
			return 0
		}
		return f
	default:
		return 0
	}
}
