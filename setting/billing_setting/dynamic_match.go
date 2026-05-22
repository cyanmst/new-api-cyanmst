package billing_setting

import (
	"encoding/json"
	"fmt"
	"strings"
)

const BillingModeDynamicMatch = "dynamic_match"

// DynamicMatchRule describes one condition → price tier.
// FieldPath is a gjson path applied to the request body (e.g. "metadata.resolution").
// Operator: "==", "contains", "prefix", "suffix", ">=", "<=", ">", "<".
// Value is compared as string (for ==, contains, prefix, suffix) or float (for numeric ops).
// PricePerUnit is the $ price for one "unit" (e.g. per-second for video).
type DynamicMatchRule struct {
	Label        string  `json:"label"`
	FieldPath    string  `json:"field_path"`
	Operator     string  `json:"operator"`
	Value        string  `json:"value"`
	PricePerUnit float64 `json:"price_per_unit"`
}

// DynamicMatchConfig is the per-model configuration for dynamic billing.
// MultiplierField is a gjson path whose numeric value is multiplied with PricePerUnit
// (e.g. "metadata.duration" for video seconds). If empty, multiplier defaults to 1.
// DefaultPrice is used when no rule matches (0 means reject request).
// Rules are evaluated top-to-bottom; first match wins.
type DynamicMatchConfig struct {
	MultiplierField string             `json:"multiplier_field,omitempty"`
	DefaultPrice    float64            `json:"default_price,omitempty"`
	Rules           []DynamicMatchRule `json:"rules"`
}

// GetDynamicMatchConfig returns the parsed config for the given model.
// Returns nil if not configured or mode is not dynamic_match.
func GetDynamicMatchConfig(model string) *DynamicMatchConfig {
	mode := GetBillingMode(model)
	if mode != BillingModeDynamicMatch {
		return nil
	}
	raw, ok := billingSetting.DynamicMatch[model]
	if !ok || strings.TrimSpace(raw) == "" {
		return nil
	}
	var cfg DynamicMatchConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		fmt.Printf("[WARN] dynamic_match config parse error for model %q: %v\n", model, err)
		return nil
	}
	if len(cfg.Rules) == 0 && cfg.DefaultPrice == 0 {
		fmt.Printf("[WARN] dynamic_match config for model %q has no rules and default_price=0, requests will be free\n", model)
	}
	return &cfg
}

// GetDynamicMatchCopy returns a shallow copy of the dynamic_match map.
func GetDynamicMatchCopy() map[string]string {
	if billingSetting.DynamicMatch == nil {
		return map[string]string{}
	}
	cp := make(map[string]string, len(billingSetting.DynamicMatch))
	for k, v := range billingSetting.DynamicMatch {
		cp[k] = v
	}
	return cp
}

// ValidateDynamicMatchConfig validates a JSON config string.
func ValidateDynamicMatchConfig(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("dynamic_match config is empty")
	}
	var cfg DynamicMatchConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if len(cfg.Rules) == 0 {
		return fmt.Errorf("at least one rule is required")
	}
	for i, rule := range cfg.Rules {
		if strings.TrimSpace(rule.FieldPath) == "" {
			return fmt.Errorf("rule[%d]: field_path is required", i)
		}
		if rule.PricePerUnit < 0 {
			return fmt.Errorf("rule[%d]: price_per_unit must be >= 0", i)
		}
		switch rule.Operator {
		case "==", "contains", "prefix", "suffix", ">=", "<=", ">", "<":
		default:
			return fmt.Errorf("rule[%d]: unsupported operator %q", i, rule.Operator)
		}
	}
	return nil
}
