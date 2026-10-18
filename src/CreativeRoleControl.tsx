import { buildCreationBrief, fieldLabels, roleLabels, type RequestedRole } from './creation-brief';
import type { Project } from './domain';

export default function CreativeRoleControl({ value, onChange, prompt, scope, project, selection }: { value: RequestedRole; onChange: (role: RequestedRole) => void; prompt: string; scope: string; project: Project; selection: string[] }) {
  const brief = buildCreationBrief({ prompt, scope, project, selection, requestedRole: value });
  return <div className="creative-role-control">
    <label>本次工作方向<select aria-label="本次工作方向" value={value} onChange={e => onChange(e.target.value as RequestedRole)}>
      <option value="auto">自动选择</option><option value="sound">音色设计</option><option value="composition">旋律与和声</option><option value="coordinator">音色与作曲协同</option>
    </select></label>
    <small>{roleLabels[brief.role]} · 可修改：{brief.allowedFields.map(f => fieldLabels[f]).join('、') || '无（受保留要求或锁定限制）'}</small>
  </div>;
}
