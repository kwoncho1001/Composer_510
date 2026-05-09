import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Note, NoteType, NoteStatus, NotePriority, OperationType } from '../types';
import { handleFirestoreError } from '../lib/utils';
import { Trash2, Save, Eye, Edit3, Sparkles, Loader2, AlertTriangle, CheckCircle2, FileWarning, PanelTop, Users, Code2, Megaphone, DollarSign, Info, Layers, History, Fingerprint, Target, Zap, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { reformatNote, analyzeLogicUnit, generateFixGuide, translateToBusinessLogic } from '../services/gemini';
import { fetchFileContent } from '../services/github';
import * as dbManager from '../services/dbManager';
import { saveNoteToSync, deleteNoteFromSync } from '../services/syncManager';

const getCleanSummary = (summary: string | undefined) => {
  if (!summary) return '';
  // 정규표현식으로 ", "differences": [ ... ] }" 형태의 찌꺼기를 잘라냄
  const match = summary.match(/^(.*?)(?:",\s*"differences"\s*:|$)/s);
  let clean = match ? match[1] : summary;
  // 끝에 남아있는 따옴표나 쉼표 제거
  clean = clean.replace(/["\s,]+$/, '');
  return clean;
};

const FormattedConflictSummary = ({ summary }: { summary: string | undefined }) => {
  if (!summary) return null;
  
  const cleanSummary = getCleanSummary(summary);
  // 문장 단위로 분리 (마침표 뒤에 공백이 있는 경우)
  const sentences = cleanSummary.split(/\.\s+/).filter(s => s.trim().length > 0);

  return (
    <div className="space-y-4">
      {sentences.map((sentence, idx) => {
        // 괄호 안의 용어 추출 (예: "(Business Logic Mismatch)")
        const termMatch = sentence.match(/\(([^)]+)\)$/);
        const term = termMatch ? termMatch[1] : null;
        const text = term ? sentence.replace(/\([^)]+\)$/, '').trim() : sentence.trim();

        return (
          <div key={idx} className="flex gap-3 group/sentence bg-destructive/5 p-3 rounded-xl border border-destructive/10 hover:border-destructive/30 transition-all">
            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-destructive/40 shrink-0 group-hover/sentence:bg-destructive transition-colors" />
            <div className="space-y-2">
              <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed font-medium">
                {text}{text.endsWith('.') ? '' : '.'}
              </p>
              {term && (
                <span className="inline-flex items-center px-2 py-0.5 bg-destructive/10 text-destructive text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-md border border-destructive/20">
                  {term}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const NoteEditor = ({ noteId, projectId, onSaved, onDeleted }: { noteId: string | null, projectId: string | null, onSaved: () => void, onDeleted?: () => void }) => {
  const { user } = useAuth();
  const [note, setNote] = useState<Partial<Note>>({
    title: '', summary: '', body: '', noteType: 'Domain', status: 'Planned', priority: '3rd',
    parentNoteIds: [], childNoteIds: []
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);
  const [conflictResolutionGuide, setConflictResolutionGuide] = useState<string | null>(null);
  const [showMetadata, setShowMetadata] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('showMetadata') !== 'false';
    }
    return true;
  });
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem('showMetadata', showMetadata.toString());
  }, [showMetadata]);

  useEffect(() => {
    setConfirmDelete(false);
    setIsDirty(false);
    setConflictResolutionGuide(null);
    if (!noteId || noteId === 'new') {
      setNote({
        title: '', summary: '', body: '', noteType: 'Domain', status: 'Planned', priority: '3rd',
        parentNoteIds: [], childNoteIds: []
      });
      return;
    }

    const fetchNote = async () => {
      try {
        const allNotes = await dbManager.getAllNotes();
        const data = allNotes.find(n => n.id === noteId) || null;
        if (data && data.status === 'Done' && data.priority !== 'Done') {
          data.priority = 'Done';
          setIsDirty(true);
        }
        if (data) {
          // Ensure string fields are not null
          data.title = data.title || '';
          data.summary = data.summary || '';
          data.body = data.body || '';
          // Ensure array fields are not undefined
          data.parentNoteIds = data.parentNoteIds || [];
          data.childNoteIds = data.childNoteIds || [];

          // Self-healing: remove child IDs that don't exist or don't have this note as parent
          const validChildIds = allNotes
            .filter(n => n.parentNoteIds?.includes(data.id))
            .map(n => n.id);
          
          if (JSON.stringify([...data.childNoteIds].sort()) !== JSON.stringify([...validChildIds].sort())) {
            data.childNoteIds = validChildIds;
            setIsDirty(true); // Trigger auto-save to fix the data
          }

          setNote(data);
          if (data.status === 'Done') setIsPreview(true);
        }
      } catch (error) {
        console.error("Failed to load note from local DB", error);
      }
    };
    fetchNote();
  }, [noteId]);

  // Debounced Auto-save
  useEffect(() => {
    if (!isDirty || noteId === 'new') return;

    const timer = setTimeout(() => {
      handleSave();
    }, 5000);

    return () => clearTimeout(timer);
  }, [note, isDirty]);

  const handleSave = async () => {
    if (!user || !projectId) return;
    setIsSaving(true);
    try {
      let finalNoteId = noteId;
      const allNotes = await dbManager.getAllNotes();
      const oldNote = allNotes.find(n => n.id === note.id);
      const oldParentIds = oldNote?.parentNoteIds || [];

      if (noteId === 'new') {
        finalNoteId = crypto.randomUUID();
        const noteToSave = {
          ...note,
          id: finalNoteId,
          projectId,
          uid: user.uid,
          lastUpdated: new Date().toISOString()
        } as Note;
        await saveNoteToSync(noteToSave);
      } else if (noteId) {
        const noteToSave = {
          ...note,
          id: finalNoteId,
          lastUpdated: new Date().toISOString(),
          uid: user.uid
        } as Note;
        await saveNoteToSync(noteToSave);
      }

      // Mirroring Logic: Update parents' childNoteIds locally and sync
      const newParentIds = note.parentNoteIds || [];
      
      // 1. Add this note to new parents
      const addedParents = newParentIds.filter(id => !oldParentIds.includes(id));
      for (const pId of addedParents) {
        const pNote = allNotes.find(n => n.id === pId);
        if (pNote) {
          const updatedParent = {
            ...pNote,
            childNoteIds: Array.from(new Set([...(pNote.childNoteIds || []), finalNoteId!]))
          };
          await saveNoteToSync(updatedParent);
        }
      }

      // 2. Remove this note from removed parents
      const removedParents = oldParentIds.filter(id => !newParentIds.includes(id));
      for (const pId of removedParents) {
        const pNote = allNotes.find(n => n.id === pId);
        if (pNote) {
          const updatedParent = {
            ...pNote,
            childNoteIds: (pNote.childNoteIds || []).filter(id => id !== finalNoteId)
          };
          await saveNoteToSync(updatedParent);
        }
      }

      setIsDirty(false);
      onSaved();
    } catch (error) {
      console.error("Failed to save note locally", error);
    } finally {
      setIsSaving(false);
    }
  };

  const updateNote = (updates: Partial<Note>) => {
    setNote(prev => {
      const next = { ...prev, ...updates };
      if (next.status === 'Done' && next.priority !== 'Done') {
        next.priority = 'Done';
      }
      return next;
    });
    setIsDirty(true);
  };

  const handleReformat = async () => {
    if (!note || !noteId || noteId === 'new') return;
    setIsFormatting(true);
    try {
      const reformatted = await reformatNote(note);
      
      const nextNote = { 
        ...note, 
        ...reformatted,
        lastUpdated: new Date().toISOString(),
        uid: user?.uid || 'local-guest'
      } as Note;
      if (nextNote.status === 'Done' && nextNote.priority !== 'Done') {
        nextNote.priority = 'Done';
      }
      
      setIsSaving(true);
      await saveNoteToSync(nextNote);
      
      setNote(nextNote);
      setIsDirty(false);
      onSaved();
    } catch (error) {
      console.error("Failed to reformat note", error);
    } finally {
      setIsFormatting(false);
      setIsSaving(false);
    }
  };

  const handleCopyAIPrompt = async () => {
    if (!note || !noteId || noteId === 'new') return;
    try {
      const allNotes = await dbManager.getAllNotes();
      const projectNotes = allNotes.filter(n => n.projectId === note.projectId);
      
      let promptText = `당신은 이 프로젝트의 수석 개발자입니다. 도메인>모듈>로직 계층 구조과 다음 명세를 바탕으로 프로그램을 구현해야 합니다.\n`;
      promptText += `위 기획서는 화면에 텍스트로 보여주기 위한 설명서가 아닙니다. 기획서에 언급된 키워드나 예시를 화면에 하드코딩해서 나열하지 마세요.\n`;
      promptText += `당신의 목표는 이 기획을 바탕으로 실제로 상호작용이 가능한(Functional) 애플리케이션을 구축하는 것입니다.\n`;
      promptText += `화면 UI를 그리기 전에, 이 기획을 작동시키기 위한 데이터 구조(상태 관리, DB 스키마 등)를 먼저 완벽하게 설계하세요. 버튼을 누르면 실제로 상태가 변하고, 기획서에 명시된대로 실제 코드가 작동하도록 로직을 구현하세요.\n`;
      promptText += `=========================================\n`;
      promptText += `\n[${note.noteType} : ${note.title}]\n`;
      promptText += `\n핵심 요약:\n${note.summary || '없음'}\n`;
      promptText += `\n문제점:\n${note.painPoint || '없음'}\n`;
      promptText += `\n해결법:\n${note.solutionPromise || '없음'}\n`;
      
      if (note.noteType === 'Domain') {
        promptText += `\n도메인 범위:\n${note.boundaries || '없음'}\n`;
        promptText += `\n성공 지표:\n${note.kpis || '없음'}\n`;
        promptText += `\n용어 정의:\n${note.glossary || '없음'}\n`;
        
        const childModules = projectNotes.filter(n => n.noteType === 'Module' && n.parentNoteIds?.includes(noteId) && n.status !== 'Done');
        if (childModules.length > 0) {
          promptText += `\n\n[도메인 하위 모듈 목록]\n`;
          childModules.forEach(mod => {
            promptText += `\n[Module : ${mod.title}]\n`;
            promptText += `\n핵심 요약:\n${mod.summary || '없음'}\n`;
            promptText += `\n요구 사항:\n${mod.requirements || '없음'}\n`;
            promptText += `\n유저 경험:\n${mod.userJourney || '없음'}\n`;
          });
        } else {
          promptText += `\n(구현할 하위 모듈이 없습니다.)\n`;
        }
      } else if (note.noteType === 'Module') {
        promptText += `\n요구 사항:\n${note.requirements || '없음'}\n`;
        promptText += `\n유저 경험:\n${note.userJourney || '없음'}\n`;
        promptText += `\n정보 구조:\n${note.ia || '없음'}\n`;
        
        const childLogics = projectNotes.filter(n => n.noteType === 'Logic' && n.parentNoteIds?.includes(noteId) && n.status !== 'Done');
        if (childLogics.length > 0) {
          promptText += `\n[모듈 하위 로직 목록]\n`;
          childLogics.forEach(logic => {
            promptText += `\n[Logic : ${logic.title}]\n`;
            promptText += `\n핵심 요약:\n${logic.summary || '없음'}\n`;
            promptText += `\n문제점:\n${logic.painPoint || '없음'}\n`;
            promptText += `\n해결법:\n${logic.solutionPromise || '없음'}\n`;
            promptText += `\n의사결정 규칙:\n${logic.businessRules || '없음'}\n`;
            promptText += `\n제약 사항:\n${logic.constraints || '없음'}\n`;
            promptText += `\n데이터 입출력:\n${logic.ioMapping || '없음'}\n`;
            promptText += `\n예외 처리:\n${logic.edgeCases || '없음'}\n`;
          });
        } else {
          promptText += `\n(구현할 하위 로직이 없습니다.)\n`;
        }
      } else if (note.noteType === 'Logic') {
        promptText += `\n의사결정 규칙:\n${note.businessRules || '없음'}\n`;
        promptText += `\n제약 사항:\n${note.constraints || '없음'}\n`;
        promptText += `\n데이터 입출력:\n${note.ioMapping || '없음'}\n`;
        promptText += `\n예외 처리:\n${note.edgeCases || '없음'}\n`;
      }
      
      await navigator.clipboard.writeText(promptText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy AI prompt", error);
      alert("프롬프트 복사에 실패했습니다.");
    }
  };

  const renderField = (label: string, field: keyof Note, value: string | undefined, placeholder: string, colorClass: string) => (
    <div className="bg-transparent sm:bg-muted/5 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative group transition-all hover:bg-muted/10 overflow-hidden">
      <div className={`absolute top-0 bottom-0 left-0 w-1 ${colorClass} opacity-40 group-hover:opacity-100 transition-all duration-300`}></div>
      <label className="block text-sm sm:text-base font-bold text-foreground">
        {label}
      </label>
      {isPreview ? (
        <div className="markdown-body text-xs sm:text-sm bg-transparent sm:bg-background/30 border-0 sm:border border-border/30 rounded-none sm:rounded-2xl p-0 sm:p-5 overflow-y-auto custom-scrollbar">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{value || ''}</ReactMarkdown>
        </div>
      ) : (
        <textarea 
          value={value || ''} 
          onChange={e => updateNote({[field]: e.target.value})}
          maxLength={50000}
          className="w-full h-48 bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-5 text-xs sm:text-sm text-foreground/80 focus:ring-2 focus:ring-primary/20 outline-none resize-none leading-relaxed transition-all custom-scrollbar"
          placeholder={placeholder}
        />
      )}
    </div>
  );

  const getFilePathForConflict = async () => {
    let filePath = note?.originPath;
    if (!filePath || filePath === '/') {
      if (note?.childNoteIds && note.childNoteIds.length > 0) {
        const allNotes = await dbManager.getAllNotes();
        const childSnapshots = allNotes.filter(n => note.childNoteIds?.includes(n.id) && n.noteType === 'Snapshot');
        if (childSnapshots.length > 0) {
          filePath = childSnapshots[0].originPath;
        }
      }
    }
    return filePath;
  };

  const handleResolveConflictWithCode = async () => {
    if (!note || !noteId || !projectId) return;
    setIsResolvingConflict(true);
    try {
      const filePath = await getFilePathForConflict();
      if (!filePath || filePath === '/') throw new Error("Could not determine the source file path for this logic.");

      const project = await dbManager.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const repoUrl = project.repoUrl;
      
      const fileContent = await fetchFileContent(repoUrl, filePath);
      const analyzed = await analyzeLogicUnit(note.title || '', fileContent);
      const businessLogic = await translateToBusinessLogic(analyzed);
      
      const nextNote = { 
        ...note, 
        summary: businessLogic.summary,
        businessRules: businessLogic.businessRules,
        constraints: businessLogic.constraints,
        ioMapping: businessLogic.ioMapping,
        edgeCases: businessLogic.edgeCases,
        status: 'Done' as NoteStatus,
        priority: 'Done' as NotePriority,
        conflictDetails: null,
        lastUpdated: new Date().toISOString(),
        uid: user?.uid || 'local-guest'
      } as Note;
      
      setIsSaving(true);
      await saveNoteToSync(nextNote);
      
      setNote(nextNote);
      setIsDirty(false);
      onSaved();
    } catch (error) {
      console.error("Failed to resolve conflict with code", error);
      alert("Failed to resolve conflict: " + (error as Error).message);
    } finally {
      setIsResolvingConflict(false);
      setIsSaving(false);
    }
  };

  const handleResolveConflictWithDesign = async () => {
    if (!note || !noteId || !projectId) return;
    setIsResolvingConflict(true);
    try {
      const filePath = await getFilePathForConflict();
      if (!filePath || filePath === '/') throw new Error("Could not determine the source file path for this logic.");

      const project = await dbManager.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const repoUrl = project.repoUrl;
      
      const fileContent = await fetchFileContent(repoUrl, filePath);
      const guide = await generateFixGuide(note as Note, fileContent);
      
      setConflictResolutionGuide(guide);
    } catch (error) {
      console.error("Failed to resolve conflict with design", error);
      alert("Failed to generate guide: " + (error as Error).message);
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const handleDelete = async () => {
    if (!noteId || noteId === 'new') return;
    try {
      const allNotes = await dbManager.getAllNotes();
      const currentNote = allNotes.find(n => n.id === noteId);
      
      if (currentNote && currentNote.parentNoteIds) {
        for (const parentId of currentNote.parentNoteIds) {
          const parentNote = allNotes.find(n => n.id === parentId);
          if (parentNote) {
            const updatedParent = {
              ...parentNote,
              childNoteIds: (parentNote.childNoteIds || []).filter(id => id !== noteId)
            };
            await saveNoteToSync(updatedParent);
          }
        }
      }

      await deleteNoteFromSync(noteId, note.projectId);
      if (onDeleted) onDeleted();
      else onSaved();
    } catch (error) {
      console.error("Failed to delete note locally", error);
    }
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'N/A';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  if (!noteId) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6 text-muted-foreground/30">
        <Save size={32} />
      </div>
      <h3 className="text-xl font-bold mb-2">No Note Selected</h3>
      <p className="text-muted-foreground max-w-xs">Select a note from the explorer or create a new one to start editing.</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-card text-foreground rounded-none sm:rounded-3xl shadow-none sm:shadow-2xl border-0 sm:border border-border overflow-hidden glass h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="p-4 sm:p-8 border-b border-border flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 sm:gap-6 bg-card relative sm:sticky top-0 z-10">
          <div className="flex-1 w-full">
          <input 
            type="text" 
            value={note.title || ''} 
            onChange={e => updateNote({title: e.target.value})}
            placeholder="Note Title..."
            maxLength={200}
            className="text-xl sm:text-3xl font-black bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/20 tracking-tighter uppercase italic"
          />
          <div className="flex items-center gap-2 sm:gap-4 mt-2 sm:mt-3 flex-wrap">
            <div className="flex items-center gap-2 px-2 py-1 bg-muted rounded text-[10px] sm:text-xs font-mono font-bold text-muted-foreground border border-border/50 max-w-full overflow-hidden">
              <span className="opacity-60 uppercase tracking-widest text-[8px] sm:text-[9px] shrink-0">UID:</span>
              <span className="truncate">{note.id || 'NEW_ENTRY'}</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1 bg-primary/10 rounded text-[10px] sm:text-xs font-mono font-bold text-primary border border-primary/20 shrink-0">
              <span className="opacity-60 uppercase tracking-widest text-[8px] sm:text-[9px]">Type:</span>
              <span>{note.noteType || 'Domain'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center w-full lg:w-auto mt-2 lg:mt-0">
          {isSaving && (
            <span className="text-[10px] font-bold text-primary animate-pulse uppercase tracking-widest sm:mr-2">
              Syncing...
            </span>
          )}
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border flex-1 sm:flex-none ${
                showMetadata 
                  ? 'bg-primary/10 text-primary border-primary/20' 
                  : 'bg-muted text-muted-foreground hover:bg-accent border-border'
              }`}
              title="Toggle Metadata"
            >
              <PanelTop size={12} />
              <span>Meta</span>
            </button>
            <button
              onClick={handleReformat}
              disabled={isFormatting || isSaving || noteId === 'new'}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border border-primary/20 disabled:opacity-50 flex-1 sm:flex-none"
              title="AI로 가독성 있게 재구성"
            >
              {isFormatting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              <span>AI Format</span>
            </button>
            {['Domain', 'Module', 'Logic'].includes(note.noteType || '') && (
              <button
                onClick={handleCopyAIPrompt}
                disabled={isCopied || noteId === 'new'}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border border-emerald-500/20 disabled:opacity-50 flex-1 sm:flex-none"
                title="AI 구현 프롬프트 복사"
              >
                {isCopied ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <Copy size={12} />
                )}
                <span>{isCopied ? 'Copied!' : 'AI Prompt'}</span>
              </button>
            )}
            <button 
              onClick={() => setIsPreview(!isPreview)}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border flex-1 sm:flex-none ${
                isPreview 
                  ? 'bg-primary/10 text-primary border-primary/20' 
                  : 'bg-muted text-muted-foreground hover:bg-accent border-border'
              }`}
              title={isPreview ? "Switch to Edit Mode" : "Switch to Preview Mode"}
            >
              {isPreview ? <Edit3 size={12} /> : <Eye size={12} />}
              {isPreview ? 'Edit' : 'Preview'}
            </button>
            <button 
              onClick={handleSave} 
              disabled={isSaving || !isDirty}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/20 active:scale-95 glow-primary disabled:opacity-50 flex-1 sm:flex-none"
            >
              <Save size={12} className={isSaving ? 'animate-spin' : ''} /> {isSaving ? 'Sync' : 'Save'}
            </button>
            {noteId !== 'new' && (
              <button 
                onClick={() => {
                  if (confirmDelete) handleDelete();
                  else setConfirmDelete(true);
                }} 
                className={`flex items-center justify-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 flex-1 sm:flex-none ${
                  confirmDelete 
                    ? 'bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20' 
                    : 'bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive border border-border'
                }`}
              >
                <Trash2 size={12} /> {confirmDelete ? 'Confirm' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-8 space-y-6 sm:space-y-12">
        {showMetadata && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
            {/* A. 노트 정보 */}
            <section className="bg-transparent sm:bg-muted/5 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-4 sm:space-y-6 relative overflow-hidden group transition-all hover:bg-muted/10">
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-green-500 opacity-40 group-hover:opacity-100 transition-all duration-300"></div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-3">
                <Info size={14} className="text-green-500" />
                A. 노트 정보
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Type</label>
                  <select 
                    value={note.noteType} 
                    onChange={e => updateNote({noteType: e.target.value as NoteType})}
                    className="w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="Domain">Domain</option>
                    <option value="Module">Module</option>
                    <option value="Logic">Logic</option>
                    <option value="Snapshot">Snapshot</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Status</label>
                    <select 
                      value={note.status} 
                      onChange={e => {
                        const newStatus = e.target.value as NoteStatus;
                        const updates: any = { status: newStatus };
                        if (newStatus === 'Done') updates.priority = 'Done';
                        updateNote(updates);
                      }}
                      className="w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer"
                    >
                      <option value="Planned">Planned</option>
                      <option value="Done">Done</option>
                      <option value="Conflict">Conflict</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Priority</label>
                    <select 
                      value={note.priority || '3rd'} 
                      onChange={e => updateNote({priority: e.target.value as NotePriority})}
                      disabled={note.status === 'Done'}
                      className={`w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer ${note.status === 'Done' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <option value="1st">1st Priority</option>
                      <option value="2nd">2nd Priority</option>
                      <option value="3rd">3rd Priority</option>
                      <option value="Done">Done</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            {/* B. 노트 계층 */}
            <section className="bg-transparent sm:bg-muted/5 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-4 sm:space-y-6 relative overflow-hidden group transition-all hover:bg-muted/10">
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-purple-500 opacity-40 group-hover:opacity-100 transition-all duration-300"></div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-3">
                <Layers size={14} className="text-purple-500" />
                B. 노트 계층
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Parent Nodes</label>
                  <textarea 
                    value={note.parentNoteIds?.join(', ') || ''} 
                    onChange={e => updateNote({parentNoteIds: e.target.value.split(',').map(s => (s || '').trim()).filter(Boolean)})}
                    className="w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none min-h-[44px]"
                    placeholder="NODE_ID_1, NODE_ID_2..."
                    rows={1}
                  />
                </div>
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Child Nodes</label>
                  <div className="w-full bg-background/30 border border-border border-dashed rounded-xl p-2 sm:p-3 text-[10px] font-mono text-muted-foreground min-h-[44px] flex flex-wrap gap-1">
                    {note.childNoteIds?.length ? note.childNoteIds.map(id => (
                      <span key={id} className="bg-muted px-1.5 py-0.5 rounded border border-border/50 text-foreground font-bold truncate max-w-full">{id}</span>
                    )) : 'NO_CHILDREN'}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Origin Path</label>
                  <div className="w-full bg-background/30 border border-border rounded-xl p-2 sm:p-3 text-[10px] font-mono font-bold text-primary truncate">
                    {note.originPath || 'LOCAL_ONLY'}
                  </div>
                </div>
              </div>
            </section>

            {/* C. 노트 버전 */}
            <section className="bg-transparent sm:bg-muted/5 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-4 sm:space-y-6 relative overflow-hidden group transition-all hover:bg-muted/10">
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-primary opacity-40 group-hover:opacity-100 transition-all duration-300"></div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-3">
                <History size={14} className="text-primary" />
                C. 노트 버전
              </h3>
              <div className="space-y-3 text-[10px]">
                <div className="flex flex-col gap-1 py-1.5 border-b border-border/30">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest">Last Updated</span>
                  <span className="font-bold font-mono text-foreground">{formatTimestamp(note.lastUpdated)}</span>
                </div>
                <div className="flex flex-col gap-1 py-1.5 border-b border-border/30">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest flex items-center gap-1">
                    <Fingerprint size={10} /> Commit SHA
                  </span>
                  <span className="font-mono text-muted-foreground break-all">{note.sha || 'UNCOMMITTED'}</span>
                </div>
                <div className="flex flex-col gap-1 py-1.5 border-b border-border/30">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest">Content Hash</span>
                  <span className="font-mono text-muted-foreground break-all">{note.contentHash || 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-1 py-1.5">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest">Embedding Hash</span>
                  <span className="font-mono text-muted-foreground break-all">{note.embeddingHash || 'N/A'}</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Content Area */}
        <div className="space-y-6 sm:space-y-8">
          {/* 1. 요약 Section */}
          <div className="bg-transparent sm:bg-muted/5 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative group transition-all hover:bg-muted/10 overflow-hidden">
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-amber-500 opacity-40 group-hover:opacity-100 transition-all duration-300"></div>
            <label className="block text-sm sm:text-base font-bold text-foreground">
              1. 요약 (Summary)
            </label>
            {isPreview ? (
              <div className="markdown-body text-xs sm:text-sm bg-transparent sm:bg-background/30 border-0 sm:border border-border/30 rounded-none sm:rounded-2xl p-0 sm:p-5 overflow-y-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.summary || ''}</ReactMarkdown>
              </div>
            ) : (
              <textarea 
                value={note.summary || ''} 
                onChange={e => updateNote({summary: e.target.value})}
                maxLength={50000}
                className="w-full h-32 bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-5 text-xs sm:text-sm text-foreground/80 focus:ring-2 focus:ring-primary/20 outline-none resize-none leading-relaxed transition-all"
                placeholder={note.noteType === 'Domain' ? "이 도메인의 정체성을 한 문장으로 정의합니다..." : (note.noteType === 'Snapshot' ? "AI가 분석한 이 코드 조각의 기술적인 핵심 기능을 정의합니다..." : "이 로직이 최종적으로 달성하려는 목적을 한 문장으로 정의합니다...")}
              />
            )}
          </div>

          {/* Strategy Section (2. 가치 제안 / 전략적 가치) */}
          {['Domain', 'Module', 'Logic'].includes(note.noteType || '') && (
            <div className="bg-transparent sm:bg-muted/5 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative overflow-hidden group transition-all hover:bg-muted/10">
              <div className="absolute top-0 bottom-0 left-0 w-1 bg-primary opacity-40 group-hover:opacity-100 transition-all duration-300"></div>
              <h3 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2 sm:gap-3">
                <Sparkles size={16} className="text-primary" />
                {note.noteType === 'Domain' ? '2. 가치 제안 (Strategic Value)' : 
                 note.noteType === 'Module' ? '2. 전략적 가치 (Strategic Pillars)' : 
                 '2. 가치 제안 (Strategic Value)'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                    <Target size={12} className="text-red-500" /> The Pain
                  </span>
                  {isPreview ? (
                    <div className="markdown-body text-xs sm:text-sm font-bold leading-relaxed bg-background/30 rounded-xl p-3 border border-border/30">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.painPoint || 'N/A'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      value={note.painPoint || ''}
                      onChange={e => updateNote({ painPoint: e.target.value })}
                      placeholder="누가 무엇 때문에 고통받고 있나요?"
                      className="w-full bg-background/50 border border-border rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none min-h-[100px]"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                    <Users size={12} className="text-blue-500" /> The People
                  </span>
                  {isPreview ? (
                    <div className="markdown-body text-xs sm:text-sm font-bold leading-relaxed bg-background/30 rounded-xl p-3 border border-border/30">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.targetAudience || 'N/A'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      value={note.targetAudience || ''}
                      onChange={e => updateNote({ targetAudience: e.target.value })}
                      placeholder="이 고통을 해결하기 위해 지갑을 열 사람은 누구인가요?"
                      className="w-full bg-background/50 border border-border rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none min-h-[100px]"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                    <Zap size={12} className="text-amber-500" /> The Promise
                  </span>
                  {isPreview ? (
                    <div className="markdown-body text-xs sm:text-sm font-bold leading-relaxed bg-background/30 rounded-xl p-3 border border-border/30">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.solutionPromise || 'N/A'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      value={note.solutionPromise || ''}
                      onChange={e => updateNote({ solutionPromise: e.target.value })}
                      placeholder="우리는 어떤 마법 같은 방법으로 이 문제를 해결할 건가요?"
                      className="w-full bg-background/50 border border-border rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none min-h-[100px]"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {note.status === 'Conflict' && (
            <div className="bg-destructive/10 border border-destructive/50 rounded-2xl sm:rounded-3xl p-4 sm:p-8 space-y-4 sm:space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-destructive/50 group-hover:bg-destructive transition-colors"></div>
              <h3 className="text-[10px] sm:text-[12px] font-black text-destructive uppercase tracking-[0.3em] flex items-center gap-2 sm:gap-3">
                <AlertTriangle size={16} />
                Conflict Detected
              </h3>

              {note.conflictDetails && (
                <div className="mt-4 sm:mt-6 space-y-4">
                  <div className="bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-4">
                    <h4 className="text-xs sm:text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                      <Sparkles size={14} className="text-primary" />
                      분석 요약
                    </h4>
                    <FormattedConflictSummary summary={note.conflictDetails.summary} />
                  </div>

                  <div className="space-y-3 sm:space-y-4">
                    {note.conflictDetails.differences.map((diff, idx) => (
                      <div key={idx} className="bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-4 space-y-3">
                        <h5 className="text-[10px] sm:text-xs font-black text-primary uppercase tracking-widest">
                          [차이점 {idx + 1}: {diff.aspect}]
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                          <div className="space-y-1">
                            <span className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-widest">📝 기획 (Design)</span>
                            <p className="text-xs sm:text-sm text-foreground/90">{diff.design}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-widest">💻 코드 (Code)</span>
                            <p className="text-xs sm:text-sm text-foreground/90">{diff.code}</p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-border/50 mt-2">
                          <span className="text-[9px] sm:text-[10px] font-black text-destructive uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} /> 영향 (Impact)
                          </span>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-1">{diff.impact}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button 
                  onClick={handleResolveConflictWithCode}
                  disabled={isResolvingConflict}
                  className="flex-1 bg-background border border-border hover:border-primary hover:bg-primary/5 p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all text-left group/btn disabled:opacity-50"
                >
                  <div className="font-bold text-primary text-xs sm:text-sm mb-1 flex items-center gap-2">
                    {isResolvingConflict ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    코드가 맞습니다 (설계 업데이트)
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                    AI가 코드의 내용을 바탕으로 기존 설계 노트를 자동으로 덮어쓰고 업데이트합니다.
                  </div>
                </button>
                <button 
                  onClick={handleResolveConflictWithDesign}
                  disabled={isResolvingConflict}
                  className="flex-1 bg-background border border-border hover:border-amber-500 hover:bg-amber-500/5 p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all text-left group/btn disabled:opacity-50"
                >
                  <div className="font-bold text-amber-500 text-xs sm:text-sm mb-1 flex items-center gap-2">
                    {isResolvingConflict ? <Loader2 size={14} className="animate-spin" /> : <FileWarning size={14} />}
                    설계가 맞습니다 (수정 가이드 생성)
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                    AI가 코드를 설계에 맞게 어떻게 수정해야 하는지 구현 보정 가이드(가이드라인)를 생성합니다.
                  </div>
                </button>
              </div>
              
              {conflictResolutionGuide && (
                <div className="mt-4 sm:mt-6 p-4 sm:p-6 bg-background border border-amber-500/30 rounded-xl sm:rounded-2xl">
                  <h4 className="text-[10px] sm:text-xs font-bold text-amber-500 uppercase tracking-widest mb-3 sm:mb-4">구현 보정 가이드</h4>
                  <div className="markdown-body text-xs sm:text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{conflictResolutionGuide}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {note.noteType === 'Domain' && (
            <>
              {renderField('3. 책임 범위 (Boundaries & Scope)', 'boundaries', note.boundaries, '담당하는 핵심 데이터와 프로세스, 타 도메인과의 접점, Out of Scope 명시...', 'bg-green-500')}
              {renderField('4. 성공 지표 (KPIs)', 'kpis', note.kpis, '비즈니스 지표(예: 전환율) 또는 시스템 지표(예: 응답 속도, 데이터 정확도)...', 'bg-pink-500')}
              {renderField('5. 핵심 용어집 (Glossary)', 'glossary', note.glossary, '도메인 특화 용어, 상태값의 의미, 비즈니스 개념 정의...', 'bg-amber-500')}
            </>
          )}

          {note.noteType === 'Module' && (
            <>
              {renderField('3. 핵심 요구사항 (Core Requirements)', 'requirements', note.requirements, '사용자 목표를 달성하기 위해 시스템이 반드시 갖춰야 할 기능적 조건...', 'bg-green-500')}
              {renderField('4. 사용자 여정 (User Journey)', 'userJourney', note.userJourney, '사용자가 기능을 사용하는 시나리오와 단계별 흐름...', 'bg-purple-500')}
              {renderField('5. 정보 구조 (IA)', 'ia', note.ia, '이 모듈에서 다루는 주요 데이터 객체와 그들 간의 관계...', 'bg-pink-500')}
            </>
          )}

          {note.noteType === 'Logic' && (
            <>
              {renderField('3. 의사결정 규칙 (Business Rules)', 'businessRules', note.businessRules, '만약 ~라면 ~한다 식의 로직...', 'bg-blue-500')}
              {renderField('4. 제약 조건 (Constraints)', 'constraints', note.constraints, '데이터 유효성, 보안 규칙...', 'bg-green-500')}
              {renderField('5. 데이터 입출력 매핑 (I/O Mapping)', 'ioMapping', note.ioMapping, '입력값이 결과값으로 변하는 과정...', 'bg-purple-500')}
              {renderField('6. 예외 처리 (Edge Cases)', 'edgeCases', note.edgeCases, '비정상 상황 대응 규칙...', 'bg-pink-500')}
            </>
          )}

          {note.noteType === 'Snapshot' && (
            <>
              {renderField('2. 기술적 역할 (Technical Role)', 'technicalRole', note.technicalRole, '시스템 내에서의 기술적 책임...', 'bg-blue-500')}
              {renderField('3. 구현 상세 분석 (Implementation)', 'implementation', note.implementation, '알고리즘, 디자인 패턴 설명...', 'bg-green-500')}
              {renderField('4. 의존성 및 구성 요소 (Dependencies)', 'dependencies', note.dependencies, '라이브러리, DB, API 연동...', 'bg-purple-500')}
              {renderField('5. 실행 및 데이터 흐름 (Execution Flow)', 'executionFlow', note.executionFlow, '함수 호출 순서와 데이터 변이...', 'bg-pink-500')}
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
