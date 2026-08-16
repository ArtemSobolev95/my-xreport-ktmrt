'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import pb from '../../lib/pocketbase';
pb.autoCancellation(false);
import { GripVertical, Trash2, ChevronUp, ChevronDown, ChevronRight, FolderPlus, FolderMinus } from 'lucide-react';
import {
  ClipboardDocumentListIcon,
  PencilIcon,
  HashtagIcon,
  CheckCircleIcon,
  ListBulletIcon,
  BookmarkIcon,
  CalculatorIcon,
  DocumentCheckIcon,
  ArrowRightIcon,
  HomeIcon,
  PlusIcon,
  MinusIcon,
  PhotoIcon,
  ArrowRightCircleIcon,
  DocumentDuplicateIcon
} from '@heroicons/react/24/outline';
import {
  ArrowRightCircleIcon as ArrowRightCircleSolidIcon
} from '@heroicons/react/24/solid';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  defaultDropAnimation,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { BuilderField, FieldType, QuickButtonGroup } from '../../types/builder';

import { motion, AnimatePresence } from 'framer-motion';
import withAuth from '../../components/withAuth';
import UserHeader from '../../components/UserHeader';
import dynamic from 'next/dynamic';
import { migrateQuickButtons } from '../../lib/migrateQuickButtons';



const availableFields = [
  { type: 'header' as FieldType, label: 'Заголовок', icon: <ClipboardDocumentListIcon className="w-7 h-7" /> },
  { type: 'text' as FieldType, label: 'Текст', icon: <PencilIcon className="w-7 h-7" /> },
  { type: 'number' as FieldType, label: 'Число', icon: <HashtagIcon className="w-7 h-7" /> },
  { type: 'checkbox' as FieldType, label: 'Чекбокс', icon: <CheckCircleIcon className="w-7 h-7" /> },
  { type: 'select' as FieldType, label: 'Список', icon: <ListBulletIcon className="w-7 h-7" /> },
  { type: 'rating' as FieldType, label: 'Шкала', icon: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
      <path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75ZM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 0 1-1.875-1.875V8.625ZM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 0 1 3 19.875v-6.75Z" />
    </svg>
  )},
  { type: 'notes' as FieldType, label: 'Заметки', icon: <BookmarkIcon className="w-7 h-7" /> },
  { type: 'formula' as FieldType, label: 'Формула', icon: <CalculatorIcon className="w-7 h-7" /> },
];

function SortableField({ 
  field, 
  isSelected, 
  onSelect, 
  onRemove, 
  onUpdate,
  onDuplicate,
  // Пропсы ниже используются ТОЛЬКО в блоке notes
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showAddLinkModal,
  setShowAddLinkModal,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tempLinkText,
  setTempLinkText,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tempLinkUrl,
  setTempLinkUrl,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleAddLink
}: {
  field: BuilderField;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BuilderField>) => void;
  onDuplicate: (id: string) => void; 
  showAddLinkModal: boolean;
  setShowAddLinkModal: (open: boolean) => void;
  tempLinkText: string;
  setTempLinkText: (text: string) => void;
  tempLinkUrl: string;
  setTempLinkUrl: (url: string) => void;
  handleAddLink: (fieldId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const [checked, setChecked] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);

  
  const formulaValues = useMemo(() => {
    const values: Record<string, number> = {};
    (field.variables || []).forEach(v => {
      values[v.name] = v.value ? parseFloat(v.value) || 0 : 0;
    });
    return values;
  }, [field.variables]);

  const evaluateFormula = (expr: string) => {
    if (!expr) return '—';
    try {
      const vars = Object.keys(formulaValues);
      const values = Object.values(formulaValues);
      const func = new Function(...vars, `return ${expr};`);
      const result = func(...values);
      return isNaN(result) ? 'Ошибка' : Number(result).toFixed(2);
    } catch {
      return 'Ошибка';
    }
  };

  const addVariable = () => {
    const currentVars = field.variables || [];
    const newVarName = String.fromCharCode(97 + currentVars.length);
    onUpdate(field.id, { variables: [...currentVars, { name: newVarName, value: '0' }] });
  };

  const removeVariable = (index: number) => {
    const currentVars = field.variables || [];
    const newVars = [...currentVars];
    newVars.splice(index, 1);
    onUpdate(field.id, { variables: newVars });
  };

  const updateVariableName = (index: number, newName: string) => {
    const currentVars = field.variables || [];
    const newVars = [...currentVars];
    newVars[index].name = newName;
    onUpdate(field.id, { variables: newVars });
  };

  const updateVariableValue = (index: number, newValue: string) => {
    const currentVars = field.variables || [];
    const newVars = [...currentVars];
    newVars[index].value = newValue;
    onUpdate(field.id, { variables: newVars });
  };

  

  const handleAddImage = async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const record = await pb.collection('notes_images').create(formData);

     
      const publicUrl = pb.files.getURL(record, record.file);

      setTempLinkText('Изображение');
      setTempLinkUrl(publicUrl);
      setShowAddLinkModal(true);
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        alert('Ошибка загрузки изображения: ' + errorMessage);
    }
  };
  input.click();
};

  const deleteLink = (index: number) => {
    const lines = (field.notes || '').split('\n').filter(Boolean);
    lines.splice(index, 1);
    onUpdate(field.id, { notes: lines.join('\n') });
  };

  const moveLinkUp = (index: number) => {
    if (index <= 0) return;
    const lines = (field.notes || '').split('\n').filter(Boolean);
    [lines[index], lines[index - 1]] = [lines[index - 1], lines[index]];
    onUpdate(field.id, { notes: lines.join('\n') });
  };

  const moveLinkDown = (index: number) => {
    const lines = (field.notes || '').split('\n').filter(Boolean);
    if (index >= lines.length - 1) return;
    [lines[index], lines[index + 1]] = [lines[index + 1], lines[index]];
    onUpdate(field.id, { notes: lines.join('\n') });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onClick={() => onSelect(field.id)}
      className={`card bg-zinc-900/75 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-2xl p-6 transition-all duration-700ms relative group
    ${isSelected 
      ? 'border-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.3)]' 
      : 'hover:border-white/20'
    }
    ${isDragging ? 'scale-105 shadow-2xl z-50' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div {...listeners} className="cursor-grab active:cursor-grabbing">
            <GripVertical className="text-zinc-400" size={20} />
          </div>
        </div>

        {/* Кнопки справа */}
        <div className="flex items-center gap-1">
          {/* Кнопка дублирования (только для текста) */}
          {field.type === 'text' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(field.id);      
              }}
              className="text-white hover:text-amber-400 transition-colors cursor-pointer tooltip tooltip-top"
              data-tip="Дублировать"
            >
              <DocumentDuplicateIcon className="w-5 h-5" />
            </button>
          )}

          {/* Кнопка удаления */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(field.id);
            }}
            className="text-white hover:text-red-400 transition-colors p-1 cursor-pointer tooltip tooltip-top"
            data-tip="Удалить"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      <div>
        {field.type === 'header' ? (
          <div className="text-xl font-bold text-white py-3 border-b border-zinc-700">
            <input type="text" value={field.label || ''} onChange={e => onUpdate(field.id, { label: e.target.value })} className="w-full bg-transparent outline-none" placeholder="Заголовок" />
          </div>
        ) : field.type === 'text' ? (
          <div>
            <input 
              type="text" 
              value={field.label || ''} 
              onChange={e => onUpdate(field.id, { label: e.target.value })} 
              className="block w-full text-sm font-medium text-zinc-400 mb-3 bg-transparent outline-none" 
              placeholder="Название поля" 
            />

            {/* Placeholder — редактируется прямо внутри карточки */}
            <div className="mb-4">
            
              <input 
                type="text" 
                value={field.placeholder || ''} 
                onChange={e => onUpdate(field.id, { placeholder: e.target.value })} 
                className="w-full bg-transparent border-0 border-b-2 border-white/20 px-0 py-3 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm" 
                placeholder="Введите значение" 
              />
            </div>

            {/* Значение по умолчанию удалено для text */}
          </div>
        ) : field.type === 'number' ? (
  <div className="space-y-6">

    {/* Название поля */}
    <input 
      type="text" 
      value={field.label || ''} 
      onChange={e => onUpdate(field.id, { label: e.target.value })} 
      className="block w-full text-sm font-medium text-zinc-400 mb-1 bg-transparent border-none border-white/20 px-0 py-0 outline-none transition-all" 
      placeholder="Название поля" 
    />

    {/* Значение + единица измерения */}
    <div className="flex gap-4">
      <div className="flex-none">
        
        <input 
          type="number" 
          step="any" 
          value={field.defaultValue || ''} 
          onChange={e => onUpdate(field.id, { defaultValue: e.target.value })} 
          className="w-10 text-center text-sm bg-transparent border-0 border-b-2 border-white/20 px-0 py-3 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all" 
          placeholder="0" 
        />
      </div>

      <div className="w-28">
      
        <input 
          type="text" 
          value={field.unit || ''} 
          onChange={e => onUpdate(field.id, { unit: e.target.value })} 
          className="w-10 text-sm bg-transparent border-0 border-b-2 border-white/20 px-1 py-3 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-center" 
          placeholder="ед" 
        />
      </div>
    </div>

  </div>

        ) : field.type === 'checkbox' ? (
          <div>
            <input type="text" value={field.label || ''} onChange={e => onUpdate(field.id, { label: e.target.value })} className="block w-full text-sm font-medium text-zinc-400 mb-2 bg-transparent outline-none" placeholder="Название" />
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="w-5 h-5 accent-zinc-400" />
              <input type="text" value={field.checkedPhrase || ''} onChange={e => onUpdate(field.id, { checkedPhrase: e.target.value })} className="flex-1 bg-transparent outline-none text-white text-sm" placeholder="Введите значение при галочке" />
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input type="checkbox" checked={false} disabled className="w-5 h-5 accent-zinc-400" />
              <input type="text" value={field.uncheckedPhrase || ''} onChange={e => onUpdate(field.id, { uncheckedPhrase: e.target.value })} className="flex-1 bg-transparent outline-none text-white text-sm" placeholder="Введите значение при пустом чекбоксе" />
            </div>
          </div>
        ) : field.type === 'select' ? (
          <div>
            <input 
              type="text" 
              value={field.label || ''} 
              onChange={e => onUpdate(field.id, { label: e.target.value })} 
              className="block w-full text-sm font-medium text-zinc-400 mb-3 bg-transparent outline-none" 
              placeholder="Название" 
            />

            <div className="space-y-2">
              {(field.options || []).map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const isDefault = field.defaultValue === option;
                      onUpdate(field.id, { defaultValue: isDefault ? '' : option });
                    }}
                    className="flex-shrink-0 text-white hover:text-amber-400 transition-colors cursor-pointer tooltip" data-tip="По умолчанию"
                  >
                    {field.defaultValue === option ? (
                      <ArrowRightCircleSolidIcon className="w-6 h-6 text-amber-400" />
                    ) : (
                      <ArrowRightCircleIcon className="w-6 h-6" />
                    )}
                  </button>

                  {/* Поле ввода варианта */}
                  <input
                    type="text"
                    value={option}
                    onChange={e => {
  const newOptions = [...(field.options || [])];
  newOptions[index] = e.target.value;
  onUpdate(field.id, { options: newOptions });
                    }}
                    className="w-full bg-transparent border-0 border-b-2 border-white/20 px-0 py-1 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm"
                    placeholder="Введите значение"
                  />

                  {/* Стрелки перемещения — СПРАВА (как в заметках) */}
                  <div className="flex flex-col">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (index === 0) return;
                        const newOptions = [...(field.options || [])];
                        [newOptions[index], newOptions[index - 1]] = [newOptions[index - 1], newOptions[index]];
                        onUpdate(field.id, { options: newOptions });
                      }}
                      className="text-zinc-400 hover:text-white px-1 cursor-pointer"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const newOptions = [...(field.options || [])];
                        if (index === newOptions.length - 1) return;
                        [newOptions[index], newOptions[index + 1]] = [newOptions[index + 1], newOptions[index]];
                        onUpdate(field.id, { options: newOptions });
                      }}
                      className="text-zinc-400 hover:text-white px-1 transition-all cursor-pointer"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>

          {/* Кнопка удаления */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const newOptions = field.options?.filter((_, i) => i !== index) || [];
              onUpdate(field.id, { options: newOptions });
            }}
            className="text-zinc-400 hover:text-red-400 transition-all cursor-pointer"
          >
            <MinusIcon className="w-4 h-4" />
          </button>
        </div>
      ))}

      {/* Кнопка добавления нового варианта */}
      <button
        onClick={() => {
          const newOptions = [...(field.options || []), ''];
          onUpdate(field.id, { options: newOptions });
        }}
        className="w-full flex items-center justify-center py-3 text-blue-400 hover:text-blue-300"
      >
        <PlusIcon className="w-5 h-5 text-white hover:text-amber-400 transition-all cursor-pointer" />
      </button>
    </div>
  </div>
        ) : field.type === 'rating' ? (
  <div className="space-y-6">

    {/* Название поля */}
    <input 
      type="text" 
      value={field.label || ''} 
      onChange={e => onUpdate(field.id, { label: e.target.value })} 
      className="block w-full text-sm font-medium text-zinc-400 mb-1 bg-transparent border-none px-0 py-2 outline-none transition-all" 
      placeholder="Название шкалы" 
    />

    {/* Количество баллов */}
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-zinc-400">Количество категорий</label>
      <input 
        type="number" 
        value={field.max || 5} 
        onChange={e => onUpdate(field.id, { max: parseInt(e.target.value) || 5 })} 
        min={2} 
        max={10} 
        className="w-20 px-4 py-1 bg-white/5 border border-white/10 rounded-2xl text-white text-center focus:border-amber-400 focus:outline-none transition-all" 
      />
    </div>

    {/* Включить пояснения */}
    <label className="flex items-center gap-3 cursor-pointer text-sm text-zinc-300">
      <input 
        type="checkbox" 
        checked={field.showExplanations || false} 
        onChange={e => onUpdate(field.id, { showExplanations: e.target.checked })} 
        className="w-5 h-5 accent-amber-400 bg-transparent border border-white/30 rounded focus:ring-amber-400/30" 
      />
      <span className="font-medium">Текст для каждой категории</span>
    </label>

    {/* Пояснения */}
    {field.showExplanations && (
      <div className="space-y-0 pt-2">
        {Array.from({ length: field.max || 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="font-medium text-amber-400 w-8 text-right">{i + 1}</div>
            <input 
              type="text" 
              value={field.explanations?.[i] || ''} 
              onChange={e => {
  const newExps = [...(field.explanations || Array(field.max || 5).fill(''))];
  newExps[i] = e.target.value;
  onUpdate(field.id, { explanations: newExps });
              }} 
              className="flex-1 bg-transparent border-0 border-b-2 border-white/20 px-0 py-3 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm" 
              placeholder={`Введите значение`} 
            />
          </div>
        ))}
      </div>
    )}
  </div>
        ) : field.type === 'notes' ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <BookmarkIcon className="w-6 h-6" />
              <span className="font-semibold text-lg">Заметки</span>
            </div>

            <div className="flex gap-0 mb-1">
              {/* Добавить ссылку */}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onSelect(field.id);           // ← важно!
                  setShowAddLinkModal(true); 
                }} 
                className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-white px-4 py-2 border-none cursor-pointer tooltip tooltip-top"
                data-tip="Добавить ссылку"
              >
                <PlusIcon className="w-5 h-5 text-white hover:text-amber-400 transition-all" />
              </button>

              {/* Добавить изображение */}
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onSelect(field.id);           // ← важно!
                  handleAddImage(); 
                }} 
                className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-white px-4 py-2 border-none cursor-pointer tooltip tooltip-top"
                data-tip="Загрузить изображение"
              >
                <PhotoIcon className="w-5 h-5 text-white hover:text-amber-400 transition-all" />
              </button>
            </div>

            {field.notes && (
              <div className="space-y-1">
                {field.notes.split('\n').filter(Boolean).map((line, index) => {
                  const match = line.match(/\[(.*?)\]\((.*?)\)/);
                  if (!match) return null;
                  const [, text, url] = match;
                  return (
                    <div key={index} className="flex items-center justify-between bg-transparent border border-none rounded-none px-0 py-0">
                      <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-white hover:text-amber-400 underline text-sm flex-1 transition-all"
                      >
                        {text}
                      </a>

                      {/* Вертикальные Chevron — как в "Выбор из списка" */}
                      <div className="flex flex-col ml-4 gap-px">
                        <button 
                          onClick={(e) => { e.stopPropagation(); moveLinkUp(index); }} 
                          className="text-zinc-400 hover:text-white px-1 py-0 cursor-pointer transition-all"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); moveLinkDown(index); }} 
                          className="text-zinc-400 hover:text-white px-1 py-0 cursor-pointer transition-all"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>

                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteLink(index); }} 
                        className="text-zinc-400 ml-3 hover:text-red-400 transition-all 0 cursor-pointer"
                      >
                        <MinusIcon className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : field.type === 'formula' ? (
          <div className="space-y-3">
            <input type="text" value={field.label || ''} onChange={e => onUpdate(field.id, { label: e.target.value })} className="block w-full text-sm font-medium text-zinc-400 mb-1 bg-transparent outline-none" placeholder="Название" />
            <input type="text" value={field.formula || ''} onChange={e => onUpdate(field.id, { formula: e.target.value })} className="w-full bg-transparent border-0 border-b-2 border-white/20 px-0 py-3 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm" />
            <div className="flex items-center justify-between text-sm text-white">
              <span>Переменные</span>
              
            </div>
            <div className="space-y-0">
              {(field.variables || []).map((v, i) => (
              <div key={i} className="w-full bg-transparent px-0 py-0 text-white placeholder:text-zinc-400 hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all text-sm">
                  <input type="text" value={v.name} onChange={e => updateVariableName(i, e.target.value)} className="w-9 text-center bg-transparent border-0 border-b-2 border-white/20 px-0 py-2 text-white text-sm hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all" />
                  <span className="text-zinc-400 font-medium mx-4">=</span>
                  <input type="text" value={v.value || ''} onChange={e => updateVariableValue(i, e.target.value)} className="w-9 text-center bg-transparent border-0 border-b-2 border-white/20 px-0 py-2 text-white text-sm hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all" />
                  <button onClick={() => removeVariable(i)} className="text-white hover:text-red-400 transition-all cursor-pointer">Удалить</button>
                </div>
              ))}
            </div>
            <div>
              <button onClick={addVariable} className="flex items-center gap-1 text-sm text-white hover:text-amber-400 transition-all cursor-pointer">Добавить переменную
                
              </button>
            </div>  
            <div className="flex items-center gap-3 mt-1">
              <span className="text-white text-sm mt-1">Результат:</span>
              <span className="text-white text-sm mt-1">{field.formula ? evaluateFormula(field.formula) : '—'}</span>
              <input type="text" value={field.unit || ''} onChange={e => onUpdate(field.id, { unit: e.target.value })} className="w-9 text-center mt-1 bg-transparent border-0 border-b-2 border-white/20 px-0 py-2 text-white text-sm hover:border-zinc-400 focus:border-amber-400 focus:outline-none focus:bg-white/5 transition-all" />
            </div>
          </div>
        
          ) : null}
            
      </div>

      
    </div>
  );
}

function TemplateBuilder() {
  const router = useRouter();
  const user = pb.authStore.record;
  const { edit } = router.query;
  const [templateTitle, setTemplateTitle] = useState("Новый шаблон");
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  
  const [showSaveModal, setShowSaveModal] = useState(false);

  const updateQuickButtons = (
    fieldId: string,
    updater: (draft: QuickButtonGroup[]) => QuickButtonGroup[]
  ) => {
    const fieldIndex = fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) return;

    const current = fields[fieldIndex].quickButtons || [];
    const cloned = structuredClone(current) as QuickButtonGroup[];
    const updated = updater(cloned);

    updateField(fieldId, { quickButtons: updated });
  };
  
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  const [tempLinkText, setTempLinkText] = useState('');
  const [tempLinkUrl, setTempLinkUrl] = useState('');

  const handleAddLink = (fieldId: string) => {
    if (!tempLinkUrl) {
      setShowAddLinkModal(false);
      return;
    }
    const current = fields.find(f => f.id === fieldId)?.notes || '';
    const link = `[${tempLinkText || tempLinkUrl}](${tempLinkUrl})`;
    updateField(fieldId, { notes: current ? current + '\n' + link : link });
    setTempLinkText('');
    setTempLinkUrl('');
    setShowAddLinkModal(false);
  };

  const [activeId, setActiveId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [activeType, setActiveType] = useState<'field' | 'quickButton' | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const DynamicUserHeader = dynamic(() => import('../../components/UserHeader'), { ssr: false });


  useEffect(() => {
  if (edit) {
    setEditingId(edit as string);

    const loadTemplate = async () => {
      try {
        const record = await pb.collection('templates').getOne(edit as string, { $autoCancel: false });

setTemplateTitle(record.title || "Новый шаблон");

const migratedFields = (record.fields || []).map((f: any) => ({
  ...f,
  quickButtons: migrateQuickButtons(f.quickButtons),
}));

setFields(migratedFields);
      } catch (err) {
        console.error("Ошибка загрузки шаблона в Builder:", err);
      }
    };

    loadTemplate();
  }
}, [edit]);

  const addField = (type: FieldType) => {
    let newField: BuilderField = {
      id: Date.now().toString(36),
      type,
      label: '',
      defaultValue: type === 'checkbox' ? false : type === 'rating' ? 0 : '',
      placeholder: '',
      required: false,
      options: type === 'select' ? [''] : undefined,
      unit: type === 'number' ? 'см' : type === 'formula' ? '' : undefined,
      max: type === 'rating' ? 5 : undefined,
      checkedPhrase: type === 'checkbox' ? 'Да' : undefined,
      uncheckedPhrase: type === 'checkbox' ? 'Нет' : undefined,
      explanations: type === 'rating' ? Array(5).fill('') : undefined,
      showExplanations: false,
      notes: type === 'notes' ? '' : undefined,
      formula: type === 'formula' ? 'a + b' : undefined,
      variables: type === 'formula' ? [{ name: 'a', value: '0' }, { name: 'b', value: '0' }] : undefined,
      
    };

    if (type === 'text') {
      newField = {
        ...newField,
        quickButtons: [],
        isQuickText: true,
      } as BuilderField;
    }

    if (selectedFieldId) {
      const index = fields.findIndex(f => f.id === selectedFieldId);
      if (index !== -1) {
        setFields([
          ...fields.slice(0, index + 1),
          newField,
          ...fields.slice(index + 1)
        ]);
        setSelectedFieldId(newField.id);
        return;
      }
    }

    setFields([...fields, newField]);
    setSelectedFieldId(newField.id);
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
  };

  const duplicateField = (id: string) => {
    const index = fields.findIndex(f => f.id === id);
    if (index === -1) return;

    const original = fields[index];
    if (original.type !== 'text') return;

    const newField: BuilderField = {
      ...JSON.parse(JSON.stringify(original)),
      id: 'text-' + Date.now().toString(36),
    };

    const newFields = [
      ...fields.slice(0, index + 1),
      newField,
      ...fields.slice(index + 1)
    ];

    setFields(newFields);
    setSelectedFieldId(newField.id);   // сразу выделяем дублированное поле
  };

  const updateField = (id: string, updates: Partial<BuilderField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFields(items => arrayMove(items, items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id)));
    }
    setActiveId(null);
    setActiveType(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setActiveType('field');
  };

  const renderDragOverlay = () => {
    if (!activeId) return null;
    const field = fields.find(f => f.id === activeId);
    if (!field) return null;
    return <div className="bg-zinc-900 border border-white/30 rounded-2xl p-6 shadow-2xl opacity-75 scale-105 pointer-events-none">{field.label}</div>;
  };

    const performSave = async (asNew: boolean) => {
      setIsSaving(true);

      const payload = {
        title: templateTitle,
        fields: JSON.parse(JSON.stringify(fields)),
        user: user?.id,
        isPublic: false
      };

      try {
        if (editingId && !asNew) {
          await pb.collection('templates').update(editingId, payload);
        } else {
          const newRecord = await pb.collection('templates').create(payload);
          setEditingId(newRecord.id);
        }
        router.push('/');
      } catch (err: unknown) {
     console.error("Ошибка сохранения шаблона:", err);
     const errorMessage = err instanceof Error ? err.message : String(err);
     alert("Ошибка при сохранении шаблона: " + errorMessage);
   } finally {
        setIsSaving(false);
        setShowSaveModal(false);
      }
    };

  const handleSaveClick = () => {
    setShowSaveModal(true);
  };

  const goToFiller = () => {
    if (editingId) router.push(`/filler?id=${editingId}`);
    else alert('Сначала сохраните шаблон');
  };

  const goToList = () => router.push('/');

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">

      <div className="sticky top-0 z-50 bg-zinc-900/90 backdrop-blur-xl border-b border-white/10">
  <DynamicUserHeader />
</div>

      <div className="flex flex-1 overflow-hidden">


      {/* ЛЕВАЯ ПАНЕЛЬ */}
      <div className="w-64 bg-zinc-900/75 backdrop-blur-2xl border-r border-white/10 shadow-2xl p-2 overflow-auto flex flex-col">
        
                <div className="space-y-1 flex-1 pt-6">
          {availableFields.map(item => (
            <button key={item.type} onClick={() => addField(item.type)} className="w-full flex items-center gap-4 p-3 hover:bg-zinc-800 hover:text-amber-400 rounded-xl transition-all text-left group cursor-pointer">
              <div className="w-7 h-7 rounded-2xl flex items-center justify-center text-3xl shadow-inner bg-none group-hover:scale-105 transition-transform">
                {item.icon}
              </div>
              <span className="font-medium text-sm tracking-tight text-white">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-10 pb-40 overflow-auto">
                <div className="max-w-3xl mx-auto">
          <input 
            type="text" 
            value={templateTitle} 
            onChange={(e) => setTemplateTitle(e.target.value)} 
            className="w-full text-2xl font-semibold bg-transparent border-b border-zinc-700 hover:border-zinc-400 focus:border-amber-400 outline-none pb-4 mb-8 tracking-tight transition-colors" 
            placeholder="Название шаблона" 
          />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-4 max-w-3xl mx-auto">
              {fields.length === 0 && <div className="text-center py-24 text-zinc-500 border-2 border-none border-zinc-700 rounded-none">Выберите инсутрумент из левой панели</div>}
              {fields.map(field => (
                <SortableField 
  key={field.id} 
  field={field} 
  isSelected={selectedFieldId === field.id} 
  onSelect={setSelectedFieldId} 
  onRemove={removeField} 
  onUpdate={updateField} 
  onDuplicate={duplicateField}
  showAddLinkModal={showAddLinkModal}
  setShowAddLinkModal={setShowAddLinkModal}
  tempLinkText={tempLinkText}
  setTempLinkText={setTempLinkText}
  tempLinkUrl={tempLinkUrl}
  setTempLinkUrl={setTempLinkUrl}
  handleAddLink={handleAddLink}
/>
              ))}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={defaultDropAnimation}>
            {renderDragOverlay()}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ПРАВАЯ ПАНЕЛЬ */}
      <div className="w-[400px] min-w-[300px] max-w-[680px] flex-shrink-0 bg-zinc-900 border-l border-zinc-800 flex flex-col">
        {selectedFieldId && fields.find(f => f.id === selectedFieldId)?.type === 'text' ? (
  <div className="flex-1 overflow-auto p-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-semibold text-lg tracking-tigh">Быстрые кнопки</h3>
      <button
        onClick={() => {
  if (!selectedFieldId) return;

  updateQuickButtons(selectedFieldId, (draft) => {
    // 1. Находим индекс последней раскрытой группы
    let insertAfterIndex = -1;
    for (let i = 0; i < draft.length; i++) {
      if (draft[i].isExpanded) {
        insertAfterIndex = i;
      }
    }

    // 2. Создаём новую группу
    const newGroup: QuickButtonGroup = {
      id: Date.now().toString(36),
      label: '',
      isExpanded: true,
      phrases: [''],
    };

    // 3. Вставляем
    if (insertAfterIndex === -1) {
      // Никто не раскрыт → в конец
      draft.push(newGroup);
    } else {
      // Вставляем сразу после последней раскрытой
      draft.splice(insertAfterIndex + 1, 0, newGroup);
    }

    // 4. (рекомендую) Закрываем все остальные группы
    draft.forEach((g, idx) => {
      g.isExpanded = idx === (insertAfterIndex === -1 ? draft.length - 1 : insertAfterIndex + 1);
    });

    return draft;
  });
}}  
        className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
      >
        <PlusIcon className="w-5 h-5 text-white hover:text-amber-400 cursor-pointer transition-all" />
      </button>
    </div>

    <div className="space-y-1">
  {(fields.find(f => f.id === selectedFieldId)?.quickButtons || []).map((group: QuickButtonGroup, gIndex: number) => (
    <div key={group.id} className="bg-none border border-transparent p-0">
      {/* Группа */}
      <div className="flex items-center gap-1 mb-3">
        <button
          onClick={() => {
            updateQuickButtons(selectedFieldId!, (draft) => {
              draft[gIndex].isExpanded = !draft[gIndex].isExpanded;
              return draft;
            });
          }}
          className="text-zinc-400 hover:text-white transition-all cursor-pointer"
          style={{ transform: group.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRight size={18} />
        </button>
        <input
          type="text"
          value={group.label}
          onChange={e => {
            updateQuickButtons(selectedFieldId!, (draft) => {
              draft[gIndex].label = e.target.value;
              return draft;
            });
          }}
          className="flex-1 bg-transparent text-sm font-semibold outline-none"
          placeholder="Название группы"
        />
        <button
          onClick={() => {
            updateQuickButtons(selectedFieldId!, (draft) => {
              draft.splice(gIndex, 1);
              return draft;
            });
          }}
          className="text-white hover:text-red-400 transition-all cursor-pointer"
        >
          <Trash2 size={17} />
        </button>
      </div>

      {/* Фразы */}
      <AnimatePresence>
        {group.isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="pl-4 space-y-2 overflow-hidden"
          >
            {(group.phrases || []).map((phrase, pIndex) => (
              <div key={pIndex} className="flex items-center gap-1">
                <input
                  type="text"
                  value={phrase}
                  onChange={e => {
                    updateQuickButtons(selectedFieldId!, (draft) => {
                      draft[gIndex].phrases[pIndex] = e.target.value;
                      return draft;
                    });
                  }}
                  className="flex-1 min-w-0 bg-transparent border border-transparent px-4 py-2 text-xs focus:outline-none focus:ring-0"
                  placeholder="Фраза"
                />
                <button
                  onClick={() => {
                    updateQuickButtons(selectedFieldId!, (draft) => {
                      draft[gIndex].phrases.splice(pIndex + 1, 0, '');
                      return draft;
                    });
                  }}
                  className="text-white hover:text-amber-400 cursor-pointer transition-all"
                >
                  <PlusIcon className="w-4 h-4" />
                </button>
                {pIndex > 0 && (
                  <button
                    onClick={() => {
                      updateQuickButtons(selectedFieldId!, (draft) => {
                        draft[gIndex].phrases.splice(pIndex, 1);
                        return draft;
                      });
                    }}
                    className="text-white hover:text-red-400 cursor-pointer transition-all"
                  >
                    <MinusIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  ))}
</div>
  <div className="h-[300px] flex-shrink-0"></div>
  </div>
) : (
  <div className="flex-1 flex items-center justify-center text-zinc-500 text-center px-6">
    Выберите текстовое поле слева,<br />чтобы редактировать его быстрые кнопки
  </div>
)}

<div className="mt-auto bg-zinc-900/75  border-t border-white/10 p-4 flex gap-1 justify-center">
        <button
          onClick={handleSaveClick}
          disabled={isSaving}
          className="w-11 h-11 flex items-center justify-center bg-none hover:text-amber-400 text-white rounded-none shadow-2xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer tooltip tooltip-top"
        data-tip="Сохранить шаблон"
        >
          <DocumentCheckIcon className="w-6 h-6" />
        </button>
        <button onClick={goToFiller} className="w-11 h-11 flex items-center justify-center bg-none hover:text-amber-400 text-white rounded-none shadow-2xl transition-all active:scale-95 cursor-pointer tooltip tooltip-top" data-tip="Заполнить протокол"><ArrowRightIcon className="w-6 h-6" 
        
        /></button>
      
        <button onClick={goToList} className="w-11 h-11 flex items-center justify-center bg-none hover:text-amber-400 text-white rounded-none shadow-2xl transition-all active:scale-95 cursor-pointer tooltip tooltip-top" data-tip="К шаблонам"><HomeIcon className="w-6 h-6" 
        
        /></button>
        
      </div>
      </div>
      </div>

    
      
      

      {showSaveModal && (
  <dialog 
    className="modal modal-open"
    onKeyDown={(e) => {
      if (e.key === 'Enter') performSave(false);
      if (e.key === 'Escape') setShowSaveModal(false);
    }}
  >
    <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-sm mx-4">

      {/* Шапка */}
      <div className="px-6 pt-5 pb-3 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white">Сохранение шаблона</h2>
      </div>

      {/* Кнопки */}
      <div className="px-6 py-5 space-y-3">
        <button
          onClick={() => performSave(false)}
          className="w-full py-4 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 hover:text-amber-400 rounded-2xl text-white text-base font-medium transition-all cursor-pointer"
        >
          Сохранить
        </button>

        <button
          onClick={() => performSave(true)}
          className="w-full py-4 bg-white/5 hover:bg-amber-400/10 border border-white/10 hover:border-amber-400 hover:text-amber-400 rounded-2xl text-white text-base font-medium transition-all cursor-pointer"
        >
          Сохранить как новый шаблон
        </button>
      </div>

      {/* Отмена */}
      <div className="px-6 pb-6">
        <button
          onClick={() => setShowSaveModal(false)}
          className="w-full py-3 text-zinc-400 hover:text-white transition-all cursor-pointer"
        >
          Отмена
        </button>
      </div>
    </div>

    <form method="dialog" className="modal-backdrop">
      <button onClick={() => setShowSaveModal(false)}>close</button>
    </form>
  </dialog>
)}


      {showAddLinkModal && (
        <dialog 
          className="modal modal-open"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddLink(selectedFieldId!);
            if (e.key === 'Escape') setShowAddLinkModal(false);
          }}
        >
          <div className="modal-box bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl max-w-md mx-4">
            <div className="px-6 pt-5 pb-3 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">Добавить ссылку</h2>
            </div>

            <div className="px-6 py-6 space-y-6">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Название</label>
                <input 
                  type="text" 
                  value={tempLinkText} 
                  onChange={e => setTempLinkText(e.target.value)} 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none transition-all"
                  placeholder="Введите значение"
                />
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">URL</label>
                <input 
                  type="text" 
                  value={tempLinkUrl} 
                  onChange={e => setTempLinkUrl(e.target.value)} 
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none transition-all"
                  placeholder="Введите значение "
                />
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button 
                onClick={() => setShowAddLinkModal(false)} 
                className="flex-1 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white font-medium transition-all cursor-pointer"
              >
                Отмена
              </button>
              <button 
                onClick={() => handleAddLink(selectedFieldId!)} 
                className="flex-1 py-4 bg-white/5 hover:bg-amber-400/10 hover:text-amber-400 border border-white/10 hover:border-amber-400 rounded-2xl text-white font-medium transition-all cursor-pointer"
              >
                Добавить
              </button>
            </div>
          </div>

          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowAddLinkModal(false)}>close</button>
          </form>
        </dialog>
      )}

    </div>
  );
}
export default withAuth(TemplateBuilder);