import { useState } from 'react';
import type { ModelProfile } from '../../types';
import { Button } from '../ui/Button';
import { Surface } from '../ui/Surface';
import { friendlyUrl } from './modelsShared';
import type { useModelConfigActions } from '../../hooks/useModelConfigActions';

type ModelConfigActions = ReturnType<typeof useModelConfigActions>;

type ModelsProfilesProps = {
  profiles: ModelProfile[];
  actions: ModelConfigActions;
};

export function ModelsProfiles({ profiles, actions }: ModelsProfilesProps) {
  const [creating, setCreating] = useState(false);
  const defaultProfile = profiles[0];

  return (
    <Surface as="section" variant="paper" className="models-profiles__surface">
      <div className="compact-title">
        <div>
          <p className="eyebrow">第一步</p>
          <h3>模型档案</h3>
        </div>
        <Button variant="secondary" onClick={() => setCreating((value) => !value)}>
          {creating ? '收起新增' : '新增模型'}
        </Button>
      </div>
      {creating && (
        <ModelProfileCard
          profile={profileDraft(defaultProfile)}
          mode="create"
          actions={actions}
          onDone={() => setCreating(false)}
        />
      )}
      <div className="model-profile-list">
        {profiles.map((profile) => (
          <ModelProfileCard profile={profile} key={profile.id} mode="edit" actions={actions} />
        ))}
      </div>
    </Surface>
  );
}

type ModelProfileCardProps = {
  profile: ModelProfile;
  mode: 'create' | 'edit';
  actions: ModelConfigActions;
  onDone?: () => void;
};

function ModelProfileCard({ profile, mode, actions, onDone }: ModelProfileCardProps) {
  const [editing, setEditing] = useState(mode === 'create');
  const [name, setName] = useState(profile.name);
  const [provider, setProvider] = useState(profile.provider);
  const [model, setModel] = useState(profile.model);
  const [baseUrl, setBaseUrl] = useState(profile.base_url);
  const [apiKeyEnv, setApiKeyEnv] = useState(profile.api_key_env);
  const [maxTokens, setMaxTokens] = useState(String(profile.max_tokens));
  const [secret, setSecret] = useState('');
  const canEdit = mode === 'create' || !profile.built_in;

  const saveInput = {
    mode,
    profile,
    name,
    provider,
    model,
    baseUrl,
    apiKeyEnv,
    maxTokens,
    secret,
    canEdit,
  };

  const savePending = mode === 'create'
    ? actions.addProvider.isPending
    : actions.updateProvider.isPending;
  const save = () => {
    if (mode === 'create') {
      actions.addProvider.mutate(saveInput);
    } else {
      actions.updateProvider.mutate({ ...saveInput, onDone: () => { setEditing(false); setSecret(''); onDone?.(); } });
    }
  };

  const secretLabel = profile.secret?.label ?? '未知';
  const canDelete = mode === 'edit' && !profile.built_in;

  return (
    <article className="route-card model-profile-card">
      <div className="model-config-card__head">
        <div>
          <strong>{profile.name}</strong>
          <span>{profile.provider_label ?? profile.provider} · {profile.model}</span>
        </div>
        <span className={`chip ${profile.secret?.status === 'missing' ? 'danger' : 'ok'}`}>
          {profile.built_in ? '内置模板' : profile.secret?.status === 'missing' ? '缺少密钥' : '可使用'}
        </span>
      </div>
      <div className="model-config-summary">
        <div><span>模型</span><strong>{profile.model || '未配置'}</strong></div>
        <div><span>接口地址</span><strong>{friendlyUrl(profile.base_url)}</strong></div>
        <div><span>密钥</span><strong>{secretLabel}</strong></div>
      </div>
      {editing && canEdit && (
        <div className="model-config-form">
          <label>
            档案名称
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Agnes 主力写作" />
          </label>
          <label>
            模型
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 agnes-2.0-flash" />
          </label>
          <label>
            接口地址
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="例如 https://apihub.agnes-ai.com/v1" />
          </label>
          <label>
            密钥环境变量
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} placeholder="例如 AGNES_API_KEY" />
          </label>
          <label className="model-config-form__secret">
            加密保存密钥
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="留空则不修改已保存密钥"
              autoComplete="new-password"
            />
          </label>
        </div>
      )}
      <details className="advanced-details">
        <summary>高级设置</summary>
        {editing && canEdit && (
          <div className="model-config-advanced-form">
            <label>
              供应商
              <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="例如 agnes" />
            </label>
            <label>
              输出上限
              <input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        )}
        <small>provider/model：{profile.provider} / {profile.model}</small>
        <small>base_url：{profile.base_url}</small>
        <small>api_key_env：{profile.api_key_env}</small>
        <small>max_tokens：{profile.max_tokens}</small>
        <small>JSON 输出：{profile.supports_json ? '支持' : '不支持'}</small>
      </details>
      <div className="model-config-actions">
        <Button
          variant="secondary"
          onClick={() => setEditing((value) => !value)}
          disabled={!canEdit || (mode === 'create' && savePending)}
        >
          {profile.built_in ? '内置只读' : editing ? '收起编辑' : '编辑档案'}
        </Button>
        <Button variant="primary" onClick={save} disabled={!editing || savePending} loading={savePending}>
          {mode === 'create' ? '保存新模型' : '保存档案'}
        </Button>
        {canDelete && (
          <Button
            variant="danger"
            onClick={() => actions.deleteProvider.mutate({ profile, canDelete })}
            disabled={actions.deleteProvider.isPending}
            loading={actions.deleteProvider.isPending}
          >
            删除档案
          </Button>
        )}
      </div>
    </article>
  );
}

function profileDraft(base?: ModelProfile): ModelProfile {
  return {
    id: 'new-profile',
    name: '',
    provider: base?.provider ?? 'agnes',
    provider_label: base?.provider_label ?? 'Agnes AI',
    model: base?.model ?? 'agnes-2.0-flash',
    base_url: base?.base_url ?? 'https://apihub.agnes-ai.com/v1',
    api_key_env: base?.api_key_env ?? 'AGNES_API_KEY',
    max_tokens: base?.max_tokens ?? 4096,
    cheap: base?.cheap ?? false,
    supports_json: base?.supports_json ?? true,
    built_in: false,
    secret: base?.secret,
  };
}
