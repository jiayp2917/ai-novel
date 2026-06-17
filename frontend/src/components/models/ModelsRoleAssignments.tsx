import { useEffect, useState } from 'react';
import type { ModelConfigRole, ModelProfile } from '../../types';
import { Button } from '../ui/Button';
import { Surface } from '../ui/Surface';
import type { useModelConfigActions } from '../../hooks/useModelConfigActions';

type ModelConfigActions = ReturnType<typeof useModelConfigActions>;

type ModelsRoleAssignmentsProps = {
  profiles: ModelProfile[];
  roles: ModelConfigRole[];
  actions: ModelConfigActions;
  onProbe: (role: string, temporaryKey?: string) => void;
  probePending: boolean;
};

export function ModelsRoleAssignments({ profiles, roles, actions, onProbe, probePending }: ModelsRoleAssignmentsProps) {
  return (
    <Surface as="section" variant="paper" className="models-role-assignments__surface">
      <div className="compact-title">
        <div>
          <p className="eyebrow">第二步</p>
          <h3>角色分配</h3>
        </div>
      </div>
      <div className="role-assignment-list">
        {roles.map((role) => (
          <RoleAssignmentRow
            key={role.role}
            role={role}
            profiles={profiles}
            actions={actions}
            onProbe={onProbe}
            probePending={probePending}
          />
        ))}
      </div>
    </Surface>
  );
}

type RoleAssignmentRowProps = {
  role: ModelConfigRole;
  profiles: ModelProfile[];
  actions: ModelConfigActions;
  onProbe: (role: string, temporaryKey?: string) => void;
  probePending: boolean;
};

function RoleAssignmentRow({ role, profiles, actions, onProbe, probePending }: RoleAssignmentRowProps) {
  const [profileId, setProfileId] = useState(role.profile_id ?? profiles[0]?.id ?? '');

  useEffect(() => {
    setProfileId(role.profile_id ?? profiles[0]?.id ?? '');
  }, [profiles, role.profile_id]);

  const assigned = profiles.find((profile) => profile.id === profileId);
  const hasError = Boolean(role.error);
  const changed = profileId !== role.profile_id;

  return (
    <article className={`role-assignment-row ${hasError ? 'model-config-card--error' : ''}`}>
      <div>
        <strong>{role.label}</strong>
        <span>{role.purpose}</span>
      </div>
      <label>
        使用模型
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={hasError}>
          {profiles.map((profile) => (
            <option value={profile.id} key={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="role-assignment-row__meta">
        <span>{assigned ? `${assigned.provider_label ?? assigned.provider} · ${assigned.model}` : role.error ?? '未分配模型'}</span>
        <span>{assigned?.secret?.label ?? role.secret?.label ?? '密钥状态未知'}</span>
      </div>
      <div className="model-config-actions">
        <Button
          variant="primary"
          onClick={() => actions.assignRole.mutate({ roleKey: role.role, roleLabel: role.label, profileId })}
          disabled={!changed || actions.assignRole.isPending || hasError}
          loading={actions.assignRole.isPending}
        >
          保存分配
        </Button>
        <Button variant="secondary" onClick={() => onProbe(role.role)} disabled={probePending || hasError}>
          测试此角色
        </Button>
      </div>
    </article>
  );
}
