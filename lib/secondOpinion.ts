// «Второе мнение» в filler: вводная строка протокола о предъявленном
// исследовании — «На предъявленной КТ органов грудной клетки от 12-05-2025
// без контрастного усиления:». Здесь справочник зон сканирования и сборка
// строки; окно и состояние — в pages/filler.tsx, место строки в
// протоколе — lib/generateReport.ts (самая первая, до «Сравнения» и
// «Примечания»).

export type SecondOpinionModality = 'КТ' | 'МРТ';
export type SecondOpinionSide = '' | 'right' | 'left' | 'both';

export interface SecondOpinion {
  modality: SecondOpinionModality | '';
  contrast: boolean;
  zone: string; // id из SECOND_OPINION_ZONES
  side: SecondOpinionSide;
  date: string; // ДД-ММ-ГГГГ
}

export const EMPTY_SECOND_OPINION: SecondOpinion = { modality: '', contrast: false, zone: '', side: '', date: '' };

// Варианты кнопки модальности в окне: модальность + контраст.
export const SECOND_OPINION_MODES: { label: string; modality: SecondOpinionModality; contrast: boolean }[] = [
  { label: 'МРТ', modality: 'МРТ', contrast: false },
  { label: 'МРТ с контрастным усилением', modality: 'МРТ', contrast: true },
  { label: 'КТ', modality: 'КТ', contrast: false },
  { label: 'КТ с контрастным усилением', modality: 'КТ', contrast: true },
];

export interface SecondOpinionZone {
  id: string;
  group: string;
  // Зона в родительном падеже — как она идёт после «КТ» / «МРТ».
  text: string;
  ct: boolean;
  mri: boolean;
  // Парная зона: сторона необязательна. sg / pl — формы для одной стороны
  // и для обеих («правого коленного сустава», «обоих коленных суставов»),
  // fem — женский род («правой кисти», «обеих кистей»).
  paired?: { sg: string; pl: string; fem?: boolean };
}

const BOTH = { ct: true, mri: true };
const CT = { ct: true, mri: false };
const MRI = { ct: false, mri: true };

const zone = (group: string, text: string, where: { ct: boolean; mri: boolean }, paired?: SecondOpinionZone['paired']): SecondOpinionZone =>
  ({ id: text, group, text, ...where, paired });

export const SECOND_OPINION_ZONES: SecondOpinionZone[] = [
  // Голова и шея
  zone('Голова и шея', 'головного мозга', BOTH),
  zone('Голова и шея', 'гипофиза', MRI),
  zone('Голова и шея', 'сосудов головного мозга', BOTH),
  zone('Голова и шея', 'сосудов головы и шеи', BOTH),
  zone('Голова и шея', 'сосудов шеи', BOTH),
  zone('Голова и шея', 'внутренних слуховых проходов', MRI),
  zone('Голова и шея', 'орбит', BOTH, { sg: 'орбиты', pl: 'орбит', fem: true }),
  zone('Голова и шея', 'височных костей', BOTH, { sg: 'височной кости', pl: 'височных костей', fem: true }),
  zone('Голова и шея', 'придаточных пазух носа', BOTH),
  zone('Голова и шея', 'костей лицевого черепа', CT),
  zone('Голова и шея', 'зубочелюстной системы', CT),
  zone('Голова и шея', 'височно-нижнечелюстных суставов', BOTH, { sg: 'височно-нижнечелюстного сустава', pl: 'височно-нижнечелюстных суставов' }),
  zone('Голова и шея', 'носоглотки', BOTH),
  zone('Голова и шея', 'гортани', BOTH),
  zone('Голова и шея', 'слюнных желез', BOTH),
  zone('Голова и шея', 'мягких тканей шеи', BOTH),
  // Позвоночник
  zone('Позвоночник', 'шейного отдела позвоночника', BOTH),
  zone('Позвоночник', 'грудного отдела позвоночника', BOTH),
  zone('Позвоночник', 'пояснично-крестцового отдела позвоночника', BOTH),
  zone('Позвоночник', 'поясничного отдела позвоночника', BOTH),
  zone('Позвоночник', 'крестца и копчика', BOTH),
  zone('Позвоночник', 'всех отделов позвоночника', BOTH),
  zone('Позвоночник', 'спинного мозга', MRI),
  zone('Позвоночник', 'крестцово-подвздошных сочленений', BOTH),
  // Грудная клетка
  zone('Грудная клетка', 'органов грудной клетки', BOTH),
  zone('Грудная клетка', 'средостения', BOTH),
  zone('Грудная клетка', 'сердца', BOTH),
  zone('Грудная клетка', 'коронарных артерий', CT),
  zone('Грудная клетка', 'легочных артерий', CT),
  zone('Грудная клетка', 'грудной аорты', BOTH),
  zone('Грудная клетка', 'аорты', BOTH),
  zone('Грудная клетка', 'молочных желез', MRI),
  // Живот и забрюшинное пространство
  zone('Брюшная полость', 'органов брюшной полости', BOTH),
  zone('Брюшная полость', 'органов брюшной полости и забрюшинного пространства', BOTH),
  zone('Брюшная полость', 'забрюшинного пространства', BOTH),
  zone('Брюшная полость', 'печени', BOTH),
  zone('Брюшная полость', 'желчевыводящих путей', MRI),
  zone('Брюшная полость', 'поджелудочной железы', BOTH),
  zone('Брюшная полость', 'почек', BOTH),
  zone('Брюшная полость', 'надпочечников', BOTH),
  zone('Брюшная полость', 'мочевыводящих путей', BOTH),
  zone('Брюшная полость', 'тонкой кишки', BOTH),
  zone('Брюшная полость', 'толстой кишки', CT),
  zone('Брюшная полость', 'брюшной аорты', BOTH),
  // Малый таз
  zone('Малый таз', 'органов малого таза', BOTH),
  zone('Малый таз', 'предстательной железы', MRI),
  zone('Малый таз', 'прямой кишки', MRI),
  zone('Малый таз', 'мочевого пузыря', BOTH),
  // Несколько областей
  zone('Несколько областей', 'органов брюшной полости и малого таза', BOTH),
  zone('Несколько областей', 'органов грудной клетки и брюшной полости', BOTH),
  zone('Несколько областей', 'органов грудной клетки, брюшной полости и малого таза', BOTH),
  zone('Несколько областей', 'шеи, органов грудной клетки, брюшной полости и малого таза', BOTH),
  zone('Несколько областей', 'всего тела', MRI),
  // Кости и суставы
  zone('Кости и суставы', 'плечевого сустава', BOTH, { sg: 'плечевого сустава', pl: 'плечевых суставов' }),
  zone('Кости и суставы', 'плечевой кости', BOTH, { sg: 'плечевой кости', pl: 'плечевых костей', fem: true }),
  zone('Кости и суставы', 'локтевого сустава', BOTH, { sg: 'локтевого сустава', pl: 'локтевых суставов' }),
  zone('Кости и суставы', 'костей предплечья', BOTH, { sg: 'предплечья', pl: 'предплечий' }),
  zone('Кости и суставы', 'лучезапястного сустава', BOTH, { sg: 'лучезапястного сустава', pl: 'лучезапястных суставов' }),
  zone('Кости и суставы', 'кисти', BOTH, { sg: 'кисти', pl: 'кистей', fem: true }),
  zone('Кости и суставы', 'костей таза', BOTH),
  zone('Кости и суставы', 'тазобедренного сустава', BOTH, { sg: 'тазобедренного сустава', pl: 'тазобедренных суставов' }),
  zone('Кости и суставы', 'бедренной кости', BOTH, { sg: 'бедренной кости', pl: 'бедренных костей', fem: true }),
  zone('Кости и суставы', 'коленного сустава', BOTH, { sg: 'коленного сустава', pl: 'коленных суставов' }),
  zone('Кости и суставы', 'костей голени', BOTH, { sg: 'голени', pl: 'голеней', fem: true }),
  zone('Кости и суставы', 'голеностопного сустава', BOTH, { sg: 'голеностопного сустава', pl: 'голеностопных суставов' }),
  zone('Кости и суставы', 'стопы', BOTH, { sg: 'стопы', pl: 'стоп', fem: true }),
  zone('Кости и суставы', 'грудины', CT),
  zone('Кости и суставы', 'ребер', CT),
  zone('Кости и суставы', 'мягких тканей', BOTH),
  // Сосуды
  zone('Сосуды', 'сосудов верхних конечностей', BOTH),
  zone('Сосуды', 'сосудов нижних конечностей', BOTH),
  zone('Сосуды', 'почечных артерий', BOTH),
  zone('Сосуды', 'вен', BOTH),
];

export const zonesFor = (modality: SecondOpinion['modality']): SecondOpinionZone[] =>
  SECOND_OPINION_ZONES.filter(z => (modality === 'КТ' ? z.ct : modality === 'МРТ' ? z.mri : true));

export const findZone = (id: string): SecondOpinionZone | undefined => SECOND_OPINION_ZONES.find(z => z.id === id);

// Зона с выбранной стороной: «правого коленного сустава», «обеих кистей»;
// без стороны — как в справочнике. Для «костей предплечья / голени» с
// выбранной стороной — «костей правого предплечья».
export const zoneText = (z: SecondOpinionZone, side: SecondOpinionSide): string => {
  if (!z.paired || !side) return z.text;
  const fem = !!z.paired.fem;
  const word = side === 'right' ? (fem ? 'правой' : 'правого')
    : side === 'left' ? (fem ? 'левой' : 'левого')
    : (fem ? 'обеих' : 'обоих');
  const noun = side === 'both' ? z.paired.pl : z.paired.sg;
  const prefix = z.text.startsWith('костей ') ? 'костей ' : '';
  return `${prefix}${word} ${noun}`;
};

// Строка готова, когда выбраны модальность и зона и введена дата.
export const isSecondOpinionComplete = (s: SecondOpinion, isValidDate: (d: string) => boolean): boolean =>
  !!s.modality && !!findZone(s.zone) && isValidDate(s.date);

export const secondOpinionLine = (s: SecondOpinion): string => {
  const z = findZone(s.zone);
  if (!s.modality || !z) return '';
  return `На предъявленной ${s.modality} ${zoneText(z, s.side)} от ${s.date} ${s.contrast ? 'с контрастным усилением' : 'без контрастного усиления'}:`;
};
