import type { QuickButtonGroup } from '../types/builder';

/**
 * Мигрирует старый формат quickButtons (Group → Subgroup → phrases)
 * в новый двухуровневый (Group → phrases).
 * Безопасно работает и с уже новыми данными.
 */
export function migrateQuickButtons(groups: any[] | undefined | null): QuickButtonGroup[] {
  if (!Array.isArray(groups) || groups.length === 0) return [];

  return groups.map((g) => {
    // Уже новый формат
    if (Array.isArray(g.phrases)) {
      return {
        id: g.id || Date.now().toString(36),
        label: g.label || '',
        isExpanded: g.isExpanded ?? true,
        phrases: g.phrases.length > 0 ? g.phrases : [''],
      };
    }

    // Старый формат: subgroups
    const phrases: string[] = [];
    (g.subgroups || []).forEach((sg: any) => {
      (sg.phrases || []).forEach((p: string) => {
        if (typeof p === 'string' && p.trim()) {
          phrases.push(p.trim());
        }
      });
    });

    return {
      id: g.id || Date.now().toString(36),
      label: g.label || '',
      isExpanded: g.isExpanded ?? true,
      phrases: phrases.length > 0 ? phrases : [''],
    };
  });
}
