import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconDelete,
  IconPlus,
  IconCode,
  IconList,
} from '@douyinfe/semi-icons';

const { Text } = Typography;

const OPERATOR_OPTIONS = [
  { value: '==', label: '==' },
  { value: 'contains', label: 'contains' },
  { value: 'prefix', label: 'prefix' },
  { value: 'suffix', label: 'suffix' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
];

const EMPTY_RULE = {
  label: '',
  field_path: '',
  operator: '==',
  value: '',
  price_per_unit: 0,
};

const EMPTY_CONFIG = {
  multiplier_field: '',
  default_price: 0,
  rules: [{ ...EMPTY_RULE }],
};

const parseConfig = (jsonStr) => {
  if (!jsonStr || !jsonStr.trim()) return { ...EMPTY_CONFIG, rules: [{ ...EMPTY_RULE }] };
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      multiplier_field: parsed.multiplier_field || '',
      default_price: parsed.default_price || 0,
      rules: Array.isArray(parsed.rules) && parsed.rules.length > 0
        ? parsed.rules
        : [{ ...EMPTY_RULE }],
    };
  } catch {
    return { ...EMPTY_CONFIG, rules: [{ ...EMPTY_RULE }] };
  }
};

const serializeConfig = (config) => {
  const clean = {
    ...config,
    rules: config.rules.filter(
      (r) => r.field_path.trim() !== '' || r.label.trim() !== '',
    ),
  };
  if (clean.rules.length === 0) return '';
  return JSON.stringify(clean, null, 2);
};

export default function DynamicMatchPricingEditor({
  model,
  onConfigChange,
  t,
}) {
  const [config, setConfig] = useState(() =>
    parseConfig(model?.dynamicMatchConfig),
  );
  const [viewMode, setViewMode] = useState('visual');

  useEffect(() => {
    setConfig(parseConfig(model?.dynamicMatchConfig));
  }, [model?.name]);

  const emitChange = useCallback(
    (nextConfig) => {
      setConfig(nextConfig);
      onConfigChange(serializeConfig(nextConfig));
    },
    [onConfigChange],
  );

  const updateField = useCallback(
    (field, value) => {
      emitChange({ ...config, [field]: value });
    },
    [config, emitChange],
  );

  const updateRule = useCallback(
    (index, field, value) => {
      const nextRules = config.rules.map((rule, i) =>
        i === index ? { ...rule, [field]: value } : rule,
      );
      emitChange({ ...config, rules: nextRules });
    },
    [config, emitChange],
  );

  const addRule = useCallback(() => {
    emitChange({ ...config, rules: [...config.rules, { ...EMPTY_RULE }] });
  }, [config, emitChange]);

  const removeRule = useCallback(
    (index) => {
      const nextRules = config.rules.filter((_, i) => i !== index);
      if (nextRules.length === 0) nextRules.push({ ...EMPTY_RULE });
      emitChange({ ...config, rules: nextRules });
    },
    [config, emitChange],
  );

  const handleRawJsonChange = useCallback(
    (val) => {
      try {
        const parsed = JSON.parse(val);
        const next = {
          multiplier_field: parsed.multiplier_field || '',
          default_price: parsed.default_price || 0,
          rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        };
        setConfig(next);
        onConfigChange(val);
      } catch {
        onConfigChange(val);
      }
    },
    [onConfigChange],
  );

  const jsonPreview = useMemo(() => serializeConfig(config), [config]);

  const validRuleCount = config.rules.filter(
    (r) => r.field_path.trim() && r.label.trim(),
  ).length;

  return (
    <div>
      <div className='mb-3 flex items-center justify-between'>
        <div className='font-medium text-gray-700'>
          {t('动态计费配置')}
          {validRuleCount > 0 && (
            <Tag color='cyan' style={{ marginLeft: 8 }}>
              {validRuleCount} {t('条规则')}
            </Tag>
          )}
        </div>
        <Button
          size='small'
          icon={viewMode === 'visual' ? <IconCode /> : <IconList />}
          onClick={() =>
            setViewMode((v) => (v === 'visual' ? 'raw' : 'visual'))
          }
        >
          {viewMode === 'visual' ? 'JSON' : t('可视化')}
        </Button>
      </div>

      {viewMode === 'raw' ? (
        <TextArea
          value={jsonPreview}
          onChange={handleRawJsonChange}
          autosize={{ minRows: 8, maxRows: 20 }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      ) : (
        <>
          <Card
            bodyStyle={{ padding: 16 }}
            style={{
              marginBottom: 12,
              background: 'var(--semi-color-fill-0)',
            }}
          >
            <div className='font-medium mb-3'>{t('全局参数')}</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              <div>
                <div className='mb-1 text-sm text-gray-600'>
                  {t('倍率字段 (gjson path)')}
                </div>
                <Input
                  value={config.multiplier_field}
                  placeholder='metadata.duration'
                  onChange={(val) => updateField('multiplier_field', val)}
                />
                <div className='mt-1 text-xs text-gray-400'>
                  {t('请求体中用于乘算的数值字段，如视频秒数。留空则默认为 1。')}
                </div>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>
                  {t('默认单价 ($/单位)')}
                </div>
                <InputNumber
                  value={config.default_price}
                  min={0}
                  step={0.01}
                  style={{ width: '100%' }}
                  onChange={(val) => updateField('default_price', val ?? 0)}
                />
                <div className='mt-1 text-xs text-gray-400'>
                  {t('无规则匹配时使用此价格。设为 0 表示拒绝请求。')}
                </div>
              </div>
            </div>
          </Card>

          <div className='font-medium mb-2 text-gray-700'>
            {t('匹配规则')}
            <span className='text-xs text-gray-400 ml-2'>
              {t('从上到下匹配，首个命中的规则生效')}
            </span>
          </div>

          {config.rules.map((rule, index) => (
            <Card
              key={index}
              bodyStyle={{ padding: 12 }}
              style={{
                marginBottom: 8,
                border: '1px solid var(--semi-color-border)',
                borderLeft: `4px solid ${
                  rule.label && rule.field_path
                    ? 'var(--semi-color-primary)'
                    : 'var(--semi-color-border)'
                }`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr 100px 1fr 100px 32px',
                  gap: 8,
                  alignItems: 'end',
                }}
              >
                <div>
                  <div className='mb-1 text-xs text-gray-500'>{t('标签')}</div>
                  <Input
                    size='small'
                    value={rule.label}
                    placeholder='1080P'
                    onChange={(val) => updateRule(index, 'label', val)}
                  />
                </div>
                <div>
                  <div className='mb-1 text-xs text-gray-500'>
                    {t('字段路径')}
                  </div>
                  <Input
                    size='small'
                    value={rule.field_path}
                    placeholder='metadata.resolution'
                    onChange={(val) => updateRule(index, 'field_path', val)}
                  />
                </div>
                <div>
                  <div className='mb-1 text-xs text-gray-500'>
                    {t('运算符')}
                  </div>
                  <Select
                    size='small'
                    value={rule.operator}
                    optionList={OPERATOR_OPTIONS}
                    onChange={(val) => updateRule(index, 'operator', val)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div className='mb-1 text-xs text-gray-500'>
                    {t('匹配值')}
                  </div>
                  <Input
                    size='small'
                    value={rule.value}
                    placeholder='1080p'
                    onChange={(val) => updateRule(index, 'value', val)}
                  />
                </div>
                <div>
                  <div className='mb-1 text-xs text-gray-500'>
                    {t('单价 $')}
                  </div>
                  <InputNumber
                    size='small'
                    value={rule.price_per_unit}
                    min={0}
                    step={0.01}
                    style={{ width: '100%' }}
                    onChange={(val) =>
                      updateRule(index, 'price_per_unit', val ?? 0)
                    }
                  />
                </div>
                <Button
                  size='small'
                  type='danger'
                  theme='borderless'
                  icon={<IconDelete />}
                  onClick={() => removeRule(index)}
                  disabled={config.rules.length <= 1}
                />
              </div>
            </Card>
          ))}

          <Button
            size='small'
            icon={<IconPlus />}
            onClick={addRule}
            style={{ marginBottom: 12 }}
          >
            {t('添加规则')}
          </Button>

          <Banner
            type='info'
            bordered
            fullMode={false}
            closeIcon={null}
            style={{ marginBottom: 12 }}
            description={t(
              '计费公式：匹配规则的单价 × 倍率字段值 = 最终价格（美元）。' +
              '例：1080P 视频 5 秒 = $2.90 × 5 = $14.50。',
            )}
          />
        </>
      )}
    </div>
  );
}
