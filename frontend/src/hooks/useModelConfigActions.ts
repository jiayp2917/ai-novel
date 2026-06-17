import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { useWorkbenchStore } from '../store';
import { useToast } from '../components/ui/Toast';
import type { ModelProfile, ProbeModelPayload } from '../types';
import { roleLabel } from '../components/modelViewUtils';

type SaveProfileInput = {
  mode: 'create' | 'edit';
  profile: ModelProfile;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  maxTokens: string;
  secret: string;
  canEdit: boolean;
  onDone?: () => void;
};

type DeleteProfileInput = {
  profile: ModelProfile;
  canDelete: boolean;
};

type AssignRoleInput = {
  roleKey: string;
  roleLabel: string;
  profileId: string;
};

type ProbeInput = {
  role: string;
  temporaryKey?: string;
};

type ProbeSuccess = (result: ProbeModelPayload) => void;

export function useModelConfigActions() {
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const { showToast } = useToast();

  const addProvider = useMutation({
    mutationFn: async (input: SaveProfileInput) => {
      if (input.mode !== 'create') {
        throw new Error('addProvider 仅用于新增模型档案。');
      }
      if (!input.canEdit) {
        throw new Error('内置模型档案不能直接修改，请先新增自定义模型。');
      }
      const result = await apiRequest<{ saved: boolean; profile: ModelProfile }>('/api/admin/model-profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          provider: input.provider,
          model: input.model,
          base_url: input.baseUrl,
          api_key_env: input.apiKeyEnv,
          max_tokens: Number(input.maxTokens),
          cheap: input.profile.cheap,
          supports_json: input.profile.supports_json,
        }),
      });
      if (input.secret.trim()) {
        await apiRequest<{ saved: boolean }>(`/api/admin/model-profiles/${result.profile.id}/secret`, {
          method: 'POST',
          body: JSON.stringify({ key: input.secret }),
        });
      }
      return result.profile;
    },
    onMutate: (input) =>
      pushTask({ label: '保存模型档案', status: 'running', detail: `正在保存 ${input.name || '模型档案'}。` }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      void queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      pushTask({ label: '保存模型档案', status: 'succeeded', detail: `${saved.name} 已保存。` });
    },
    onError: (error: Error) => {
      pushTask({ label: '保存模型档案', status: 'failed', detail: error.message });
      showToast(`保存模型档案失败：${error.message}`, 'error');
    },
  });

  const updateProvider = useMutation({
    mutationFn: async (input: SaveProfileInput) => {
      if (input.mode !== 'edit') {
        throw new Error('updateProvider 仅用于修改既有模型档案。');
      }
      if (!input.canEdit) {
        throw new Error('内置模型档案不能直接修改，请先新增自定义模型。');
      }
      const result = await apiRequest<{ saved: boolean; profile: ModelProfile }>(
        `/api/admin/model-profiles/${input.profile.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: input.name,
            provider: input.provider,
            model: input.model,
            base_url: input.baseUrl,
            api_key_env: input.apiKeyEnv,
            max_tokens: Number(input.maxTokens),
            cheap: input.profile.cheap,
            supports_json: input.profile.supports_json,
          }),
        },
      );
      if (input.secret.trim()) {
        await apiRequest<{ saved: boolean }>(`/api/admin/model-profiles/${result.profile.id}/secret`, {
          method: 'POST',
          body: JSON.stringify({ key: input.secret }),
        });
      }
      return result.profile;
    },
    onMutate: (input) =>
      pushTask({ label: '保存模型档案', status: 'running', detail: `正在保存 ${input.name || '模型档案'}。` }),
    onSuccess: (saved, input) => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      void queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      pushTask({ label: '保存模型档案', status: 'succeeded', detail: `${saved.name} 已保存。` });
      input.onDone?.();
    },
    onError: (error: Error) => {
      pushTask({ label: '保存模型档案', status: 'failed', detail: error.message });
      showToast(`保存模型档案失败：${error.message}`, 'error');
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async ({ profile, canDelete }: DeleteProfileInput) => {
      if (!canDelete) {
        throw new Error('内置模型档案不能删除。');
      }
      return apiRequest<{ deleted: boolean }>(`/api/admin/model-profiles/${profile.id}`, { method: 'DELETE' });
    },
    onMutate: ({ profile }) =>
      pushTask({ label: '删除模型档案', status: 'running', detail: `正在删除 ${profile.name}。` }),
    onSuccess: (_result, { profile }) => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      pushTask({ label: '删除模型档案', status: 'succeeded', detail: `${profile.name} 已删除。` });
    },
    onError: (error: Error) => {
      pushTask({ label: '删除模型档案', status: 'failed', detail: error.message });
      showToast(`删除模型档案失败：${error.message}`, 'error');
    },
  });

  const assignRole = useMutation({
    mutationFn: ({ roleKey, profileId }: AssignRoleInput) =>
      apiRequest<{ saved: boolean }>(`/api/admin/model-role-assignments/${roleKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_id: profileId }),
      }),
    onMutate: ({ roleLabel: label }) =>
      pushTask({ label: '分配模型角色', status: 'running', detail: `正在为 ${label} 分配模型。` }),
    onSuccess: (_result, { roleLabel: label }) => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      void queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      pushTask({ label: '分配模型角色', status: 'succeeded', detail: `${label} 的模型已更新。` });
    },
    onError: (error: Error) => {
      pushTask({ label: '分配模型角色', status: 'failed', detail: error.message });
      showToast(`分配模型角色失败：${error.message}`, 'error');
    },
  });

  const probeRole = (
    { role, temporaryKey }: ProbeInput,
    onSuccess?: ProbeSuccess,
  ): void => {
    pushTask({ label: 'AI 连通测试', status: 'running', detail: `正在测试 ${roleLabel(role)}` });
    void apiRequest<ProbeModelPayload>(`/api/admin/model-config/${role}/probe`, {
      method: 'POST',
      body: JSON.stringify({ temporary_key: temporaryKey || undefined }),
    })
      .then((result) => {
        onSuccess?.(result);
        pushTask({
          label: 'AI 连通测试',
          status: 'succeeded',
          detail: `${roleLabel(result.role)} 可用。`,
        });
      })
      .catch((error: Error) => {
        pushTask({ label: 'AI 连通测试', status: 'failed', detail: error.message });
        showToast(`AI 连通测试失败：${error.message}`, 'error');
      });
  };

  return {
    addProvider,
    updateProvider,
    deleteProvider,
    assignRole,
    probeRole,
  };
}
