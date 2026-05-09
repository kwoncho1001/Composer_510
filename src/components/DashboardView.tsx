import React, { useState, useEffect } from 'react';
import { Note, ProactiveNudge, LensType, MindMap } from '../types';
import { Layers, Blocks, Cpu, Code, AlertCircle, CheckCircle2, CircleDashed, Target, Loader2, X, Cloud, Wrench, Zap, FileText, Lightbulb, Users, Briefcase, PlusCircle, Sparkles, MessageSquarePlus, ChevronRight, LayoutGrid, Map, Check, Send, Copy, Download } from 'lucide-react';
import { ArchitectureRefinementModal } from './dashboard/ArchitectureRefinementModal';
import { KeywordInputModal, SuggestedKeywordsModal } from './dashboard/GenerationModals';
import { generateInitialBlueprint, generateProactiveNudges, generateProactiveNudgesWithKeywords, addFeatureBlueprint, refineIdeaWithSparring, generateDetailedBlueprint, refineBlueprintDraft, generateKeywords, refineMindMap, generateArchitectureInsights, generateCodeSkeleton } from '../services/gemini';
import * as dbManager from '../services/dbManager';
import { saveNoteToSync } from '../services/syncManager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { motion, AnimatePresence } from 'motion/react';
import { BentoView } from './dashboard/BentoView';
import { useCoFounder } from '../contexts/CoFounderContext';
import { JourneyView } from './dashboard/JourneyView';
import { BlueprintView } from './dashboard/BlueprintView';
import { BlueprintWizard } from './BlueprintWizard';
import { MindMapView } from './MindMapView';
import { ArchitectChat } from './ArchitectChat';

interface DashboardViewProps {
  projectId: string;
  notes: Note[];
  onSelectNote: (id: string) => void;
  onNotesChanged?: () => void;
  activeLens: LensType;
  setActiveLens: (lens: LensType) => void;
  onOpenWizard: (idea?: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ projectId, notes, onSelectNote, onNotesChanged, activeLens, setActiveLens, onOpenWizard }) => {
  const [magicIdea, setMagicIdea] = useState('');
  const [isGeneratingMagic, setIsGeneratingMagic] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isCopied, setIsCopied] = useState(false);

  const handleCopyProjectPrompt = async () => {
    try {
      const project = await dbManager.getProject(projectId);
      const domainNotes = notes.filter(n => n.noteType === 'Domain' && n.status !== 'Done');
      
      let promptText = `당신은 이 프로젝트의 수석 개발자입니다. 다음 도메인 명세를 바탕으로 전체 시스템 구조를 파악하고 코드를 작성해야 합니다.\n`;
      promptText += `기존 파일 구조를 고려하여 완성된 코드를 제공해 주세요.\n`;
      promptText += `=========================================\n`;
      
      if (project) {
        promptText += `[프로젝트 가치 제안 (Strategic Value)]\n`;
        promptText += `- Pain Point: ${project.painPoint || '없음'}\n`;
        promptText += `- Target: ${project.targetAudience || '없음'}\n`;
        promptText += `- Solution: ${project.solutionPromise || '없음'}\n`;
        promptText += `=========================================\n`;
      }

      promptText += `[프로젝트 도메인 목록]\n`;
      
      if (domainNotes.length > 0) {
        domainNotes.forEach(domain => {
          promptText += `\n[Domain : ${domain.title}]\n`;
          promptText += `[${domain.title} 요약]:\n${domain.summary || '없음'}\n`;
          promptText += `[${domain.title} Pain Point]:\n${domain.painPoint || '없음'}\n`;
          promptText += `[${domain.title} Target]:\n${domain.targetAudience || '없음'}\n`;
          promptText += `[${domain.title} Solution]:\n${domain.solutionPromise || '없음'}\n`;
          promptText += `[${domain.title} Boundaries]:\n${domain.boundaries || '없음'}\n`;
          promptText += `[${domain.title} KPIs]:\n${domain.kpis || '없음'}\n`;
          promptText += `[${domain.title} Glossary]:\n${domain.glossary || '없음'}\n`;
        });
      } else {
        promptText += `\n(구현할 도메인이 없습니다.)\n`;
      }
      
      await navigator.clipboard.writeText(promptText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy project AI prompt", error);
      setErrorMessage("프롬프트 복사에 실패했습니다.");
    }
  };

  const handleExportProject = async () => {
    try {
      const project = await dbManager.getProject(projectId);
      if (!project) return;
      
      const exportData = {
        version: "1.0",
        project,
        notes
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project_${project.name || 'export'}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export project", error);
      setErrorMessage("프로젝트 내보내기에 실패했습니다.");
    }
  };

  const [showMindMapModal, setShowMindMapModal] = useState(false);
  const [isGeneratingMindMap, setIsGeneratingMindMap] = useState(false);
  const [currentMindMap, setCurrentMindMap] = useState<MindMap | null>(null);
  const [mindMapFeedback, setMindMapFeedback] = useState('');

  const [activeView, setActiveView] = useState<'bento' | 'generator' | 'blueprint' | 'chat'>('bento');

  // Refinement Modal State
  const [showRefinementModal, setShowRefinementModal] = useState(false);
  const [draftBlueprint, setDraftBlueprint] = useState<any>(null);
  const [refiningNudge, setRefiningNudge] = useState<ProactiveNudge | null>(null);
  const [isRefiningBlueprint, setIsRefiningBlueprint] = useState(false);
  const [isFinalizingBlueprint, setIsFinalizingBlueprint] = useState(false);
  const [generationProgressMsg, setGenerationProgressMsg] = useState('');

  const [architectureInsights, setArchitectureInsights] = useState<any[]>([]);
  const [isFetchingInsights, setIsFetchingInsights] = useState(false);

  const [showSkeletonModal, setShowSkeletonModal] = useState(false);
  const [isGeneratingSkeleton, setIsGeneratingSkeleton] = useState(false);
  const [codeSkeleton, setCodeSkeleton] = useState<any>(null);
  const [selectedNoteForSkeleton, setSelectedNoteForSkeleton] = useState<Note | null>(null);

  const {
    nudges, setNudges,
    pastNudges, setPastNudges,
    loadingNudgeTypes, setLoadingNudgeTypes,
    isFetchingNudges, setIsFetchingNudges,
    isCoFounderOpen, setIsCoFounderOpen,
    applyingNudgeId, setApplyingNudgeId,
    generationMode, setGenerationMode
  } = useCoFounder();
  const [showKeywordModal, setShowKeywordModal] = useState(false);
  const [showSuggestedModal, setShowSuggestedModal] = useState(false);
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false);

  useEffect(() => {
    // Reset all AI-related states when project changes to ensure isolation
    setMagicIdea('');
    setIsGeneratingMagic(false);
    setErrorMessage(null);
    setShowMindMapModal(false);
    setIsGeneratingMindMap(false);
    setCurrentMindMap(null);
    setMindMapFeedback('');
    setShowRefinementModal(false);
    setDraftBlueprint(null);
    setRefiningNudge(null);
    setIsRefiningBlueprint(false);
    setIsFinalizingBlueprint(false);
    setGenerationProgressMsg('');
    setArchitectureInsights([]);
    setIsFetchingInsights(false);
    setShowSkeletonModal(false);
    setIsGeneratingSkeleton(false);
    setCodeSkeleton(null);
    setSelectedNoteForSkeleton(null);
  }, [projectId]);

  const handleOpenCoFounder = async () => {
    setIsCoFounderOpen(true);
    if (nudges.length === 0 && notes.length > 0) {
      setIsFetchingNudges(true);
      try {
        const results = await Promise.all([
          generateProactiveNudges(notes, pastNudges, 'Involution'),
          generateProactiveNudges(notes, pastNudges, 'Evolution')
        ]);
        console.log("Results:", results);
        if (!Array.isArray(results)) {
          console.error("results is not an array:", results);
          return;
        }
        const [involutionNudges, evolutionNudges] = results;
        console.log("involutionNudges:", involutionNudges);
        console.log("evolutionNudges:", evolutionNudges);
        const inv = Array.isArray(involutionNudges) ? involutionNudges : [];
        const evo = Array.isArray(evolutionNudges) ? evolutionNudges : [];
        setNudges([...inv, ...evo]);
      } catch (e) {
        console.error(e);
      } finally {
        setIsFetchingNudges(false);
      }
    }
  };

  const handleRerollAllNudges = async (mode?: 'auto' | 'keyword' | 'suggested') => {
    const currentMode = mode || generationMode;
    setGenerationMode(currentMode);
    
    if (currentMode === 'keyword') {
      setShowKeywordModal(true);
      return;
    }
    if (currentMode === 'suggested') {
      setIsGeneratingKeywords(true);
      const keywords = await generateKeywords(notes);
      setSuggestedKeywords(keywords);
      setIsGeneratingKeywords(false);
      setShowSuggestedModal(true);
      return;
    }
    await performGeneration([]);
  };

  const performGeneration = async (keywords: string[]) => {
    setIsFetchingNudges(true);
    setNudges([]);
    try {
      const results = await Promise.all([
        generateProactiveNudgesWithKeywords(notes, pastNudges, 'Involution', keywords),
        generateProactiveNudgesWithKeywords(notes, pastNudges, 'Evolution', keywords)
      ]);
      const [involutionNudges, evolutionNudges] = results;
      const inv = Array.isArray(involutionNudges) ? involutionNudges : [];
      const evo = Array.isArray(evolutionNudges) ? evolutionNudges : [];
      setNudges([...inv, ...evo]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingNudges(false);
    }
  };

  // Fetch nudges automatically when entering Bento view if empty
  React.useEffect(() => {
    // Removed automatic nudge generation
  }, [activeView, notes.length]);

  const handleRejectNudge = async (nudgeId: string) => {
    const rejectedNudge = nudges.find(n => n.id === nudgeId);
    if (!rejectedNudge) return;

    const newPastNudges = [...pastNudges, rejectedNudge.question].slice(-20);
    setPastNudges(newPastNudges);

    setNudges(prev => prev.filter(n => n.id !== nudgeId));
    setLoadingNudgeTypes(prev => [...prev, rejectedNudge.nudgeType]);

    try {
      const result = await generateProactiveNudges(notes, newPastNudges, rejectedNudge.track, rejectedNudge.nudgeType);
      if (result && result.length > 0) {
        setNudges(prev => [...prev, result[0]]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingNudgeTypes(prev => {
        const idx = prev.indexOf(rejectedNudge.nudgeType);
        if (idx > -1) {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        }
        return prev;
      });
    }
  };

  const handleSparringSubmit = async (nudge: ProactiveNudge, response: string) => {
    setApplyingNudgeId(nudge.id);
    try {
      const blueprint = await refineIdeaWithSparring(notes, nudge, response);
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(nudge);
        setShowRefinementModal(true);
      }
    } catch (error) {
      console.error("Failed to refine idea with sparring:", error);
      setErrorMessage("아이디어 구체화에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setApplyingNudgeId(null);
    }
  };

  const handleAcceptNudge = async (nudge: ProactiveNudge) => {
    setApplyingNudgeId(nudge.id);
    try {
      const blueprint = await addFeatureBlueprint(nudge, notes);
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(nudge);
        setShowRefinementModal(true);

        // Fetch insights in parallel for the new feature blueprint
        setIsFetchingInsights(true);
        generateArchitectureInsights(blueprint).then(res => {
          setArchitectureInsights(res.insights || []);
          setIsFetchingInsights(false);
        }).catch(() => setIsFetchingInsights(false));
      }
    } catch (error) {
      console.error("Failed to generate blueprint:", error);
      setErrorMessage("설계도 생성에 실패했습니다.");
    } finally {
      setApplyingNudgeId(null);
    }
  };

  const handleRefineBlueprint = async (feedback: string) => {
    if (!draftBlueprint) return;
    setIsRefiningBlueprint(true);
    try {
      const refined = await refineBlueprintDraft(draftBlueprint, feedback);
      setDraftBlueprint(refined);

      // Re-fetch insights for refined blueprint
      setIsFetchingInsights(true);
      generateArchitectureInsights(refined).then(res => {
        setArchitectureInsights(res.insights || []);
        setIsFetchingInsights(false);
      }).catch(() => setIsFetchingInsights(false));
    } catch (error) {
      console.error("Failed to refine blueprint:", error);
      setErrorMessage("설계 수정에 실패했습니다.");
    } finally {
      setIsRefiningBlueprint(false);
    }
  };

  const handleFinalizeBlueprint = async (finalBlueprint: any) => {
    setIsFinalizingBlueprint(true);
    setGenerationProgressMsg('아키텍처 상세화 시작...');
    try {
      const detailed = await generateDetailedBlueprint(finalBlueprint, (msg) => {
        setGenerationProgressMsg(msg);
      });

      const newNotes: Note[] = [];
      for (const domain of detailed.domains) {
        const domainId = crypto.randomUUID();
        const domainChildIds: string[] = [];
        
        if (domain.modules) {
          for (const mod of domain.modules) {
            const moduleId = crypto.randomUUID();
            const moduleChildIds: string[] = [];
            domainChildIds.push(moduleId);

            if (mod.logics) {
              for (const logic of mod.logics) {
                const logicId = crypto.randomUUID();
                moduleChildIds.push(logicId);
                
                newNotes.push({
                  id: logicId,
                  projectId,
                  title: logic.title,
                  body: logic.content || '',
                  noteType: 'Logic',
                  parentNoteIds: [moduleId],
                  childNoteIds: [],
                  summary: logic.summary,
                  businessRules: logic.businessRules,
                  constraints: logic.constraints,
                  ioMapping: logic.ioMapping,
                  edgeCases: logic.edgeCases,
                  status: 'Planned',
                  priority: '3rd',
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                } as any);
              }
            }

            newNotes.push({
              id: moduleId,
              projectId,
              title: mod.title,
              body: mod.content || '',
              noteType: 'Module',
              parentNoteIds: [domainId],
              childNoteIds: moduleChildIds,
              summary: mod.summary,
              uxGoals: mod.uxGoals,
              requirements: mod.requirements,
              userJourney: mod.userJourney,
              ia: mod.ia,
              status: 'Planned',
              priority: '3rd',
              createdAt: Date.now(),
              updatedAt: Date.now()
            } as any);
          }
        }

        newNotes.push({
          id: domainId,
          projectId,
          title: domain.title,
          body: domain.content || '',
          noteType: 'Domain',
          parentNoteIds: [],
          childNoteIds: domainChildIds,
          summary: domain.summary,
          vision: domain.vision,
          boundaries: domain.boundaries,
          stakeholders: domain.stakeholders,
          kpis: domain.kpis,
          status: 'Planned',
          priority: '3rd',
          createdAt: Date.now(),
          updatedAt: Date.now()
        } as any);
      }

      await dbManager.bulkSaveNotes(newNotes);
      if (onNotesChanged) onNotesChanged();
      
      // Remove nudge after success
      if (refiningNudge) {
        setNudges(prev => prev.filter(n => n.id !== refiningNudge.id));
      }
      setShowRefinementModal(false);
      setDraftBlueprint(null);
      setRefiningNudge(null);
    } catch (error) {
      console.error("Failed to finalize blueprint:", error);
      setErrorMessage("최종 적용에 실패했습니다.");
    } finally {
      setIsFinalizingBlueprint(false);
      setGenerationProgressMsg('');
    }
  };

  const handleMagicStart = async () => {
    if (!(magicIdea || '').trim()) return;
    onOpenWizard(magicIdea);
    setMagicIdea('');
  };

  const handleRefineMindMap = async () => {
    if (!currentMindMap || !mindMapFeedback.trim()) return;
    setIsGeneratingMindMap(true);
    try {
      const refined = await refineMindMap(currentMindMap, mindMapFeedback);
      setCurrentMindMap(refined);
      setMindMapFeedback('');
    } catch (error) {
      console.error("Mind Map refinement failed:", error);
      setErrorMessage("지도 수정에 실패했습니다.");
    } finally {
      setIsGeneratingMindMap(false);
    }
  };

  const handleConfirmMindMap = async () => {
    if (!currentMindMap) return;
    setIsGeneratingMagic(true);
    setShowMindMapModal(false);
    try {
      // Use the mind map summary and nodes to generate a better blueprint
      const context = `Summary: ${currentMindMap.summary}\nNodes: ${JSON.stringify(currentMindMap.nodes)}`;
      const blueprint = await generateInitialBlueprint(context);
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(null);
        setShowRefinementModal(true);
        setMagicIdea('');
        
        // Fetch insights in parallel
        setIsFetchingInsights(true);
        generateArchitectureInsights(blueprint).then(res => {
          setArchitectureInsights(res.insights || []);
          setIsFetchingInsights(false);
        }).catch(() => setIsFetchingInsights(false));
      }
    } catch (error) {
      console.error("Blueprint generation failed:", error);
      setErrorMessage("설계도 생성에 실패했습니다.");
    } finally {
      setIsGeneratingMagic(false);
      setCurrentMindMap(null);
    }
  };

  const handleGenerateSkeleton = async (note: Note) => {
    setSelectedNoteForSkeleton(note);
    setIsGeneratingSkeleton(true);
    setShowSkeletonModal(true);
    try {
      const skeleton = await generateCodeSkeleton(note);
      setCodeSkeleton(skeleton);
    } catch (error) {
      console.error("Failed to generate code skeleton:", error);
      setErrorMessage("코드 스켈레톤 생성에 실패했습니다.");
    } finally {
      setIsGeneratingSkeleton(false);
    }
  };

  const getNotesByType = (type: string) => {
    return notes.filter(n => n.noteType === type);
  };

  const domains = getNotesByType('Domain');
  const modules = getNotesByType('Module');
  const logics = getNotesByType('Logic');
  const snapshots = getNotesByType('Snapshot');

  const columns = [
    { title: 'Domain', icon: Layers, items: domains },
    { title: 'Module', icon: Blocks, items: modules },
    { title: 'Logic', icon: Cpu, items: logics },
    { title: 'Snapshot', icon: Code, items: snapshots },
  ];

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'Done':
        return { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: CheckCircle2 };
      case 'Conflict':
        return { color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20', icon: AlertCircle };
      case 'Planned':
      default:
        return { color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20', icon: CircleDashed };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case '1st': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case '2nd': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case '3rd': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      default: return 'text-muted-foreground/60 bg-muted border-transparent';
    }
  };

  return (
    <div className="md:h-full flex flex-col md:overflow-hidden relative bg-background">
      {errorMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 z-50 animate-in slide-in-from-top-4">
          <AlertCircle size={20} />
          <span className="font-bold text-sm">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="ml-2 hover:opacity-70"><X size={16} /></button>
        </div>
      )}
      <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-center justify-between px-4 md:px-6 pt-4 md:pt-6 gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black tracking-tight">Business Command Center</h2>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">Strategic overview of your system architecture and implementation status.</p>
        </div>
        <div className="flex items-center gap-3 overflow-x-auto hide-scrollbar">
          <button 
            onClick={handleExportProject}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 text-[10px] md:text-xs font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border border-blue-500/20 whitespace-nowrap"
            title="프로젝트 데이터 다운로드 (Export)"
          >
            <Download size={14} />
            <span>Export</span>
          </button>
          <button 
            onClick={handleCopyProjectPrompt}
            disabled={isCopied}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-[10px] md:text-xs font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border border-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
            title="프로젝트 전체 도메인 AI 프롬프트 복사"
          >
            {isCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            <span>{isCopied ? 'Copied!' : 'AI Prompt'}</span>
          </button>
          <div className="flex gap-1 md:gap-2 bg-muted/50 p-1 rounded-xl border border-border">
            <button 
              onClick={() => setActiveView('bento')}
              className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'bento' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid size={16} /> Executive
            </button>
            <button 
              onClick={() => setActiveView('generator')}
              className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'generator' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Sparkles size={16} /> Generator
            </button>
            <button 
              onClick={() => setActiveView('blueprint')}
              className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'blueprint' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Layers size={16} /> Blueprint
            </button>
            <button 
              onClick={() => setActiveView('chat')}
              className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'chat' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <MessageSquarePlus size={16} /> Chat
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 md:overflow-hidden relative">
        {activeView === 'bento' && (
          <BentoView 
            projectId={projectId}
            notes={notes} 
            onAcceptNudge={handleAcceptNudge} 
            onSparringSubmit={handleSparringSubmit}
            onRejectNudge={handleRejectNudge}
            onRerollAllNudges={handleRerollAllNudges}
            magicIdea={magicIdea}
            setMagicIdea={setMagicIdea}
            onMagicStart={handleMagicStart}
            isGeneratingMagic={isGeneratingMagic}
            isGeneratingMindMap={isGeneratingMindMap}
            onOpenWizard={onOpenWizard}
          />
        )}
        {activeView === 'generator' && (
          <div className="md:h-full md:overflow-y-auto custom-scrollbar">
            <BlueprintWizard 
              projectId={projectId} 
              initialIdea={magicIdea}
              onComplete={() => {
                onNotesChanged();
                setActiveView('bento');
                setMagicIdea('');
              }}
              onClose={() => setActiveView('bento')}
            />
          </div>
        )}
        {activeView === 'blueprint' && (
          <BlueprintView 
            notes={notes} 
            onSelectNote={onSelectNote} 
            onGenerateSkeleton={handleGenerateSkeleton}
          />
        )}
        {activeView === 'chat' && (
          <div className="h-full p-6">
            <ArchitectChat />
          </div>
        )}
      </div>

      {/* Mind Map Modal */}
      {showMindMapModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border shadow-2xl rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Lightbulb size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight">생각의 지도 (Mirroring)</h3>
                  <p className="text-xs text-muted-foreground">사용자의 아이디어를 AI가 이렇게 이해했습니다. 맞는지 확인해주세요.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowMindMapModal(false)}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {isGeneratingMindMap && !currentMindMap ? (
                <div className="h-64 flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm font-medium text-muted-foreground animate-pulse">아이디어를 분석하여 지도를 그리는 중...</p>
                </div>
              ) : currentMindMap ? (
                <MindMapView mindMap={currentMindMap} />
              ) : null}
            </div>

            <div className="p-6 border-t border-border bg-muted/30">
              <div className="flex flex-col gap-4">
                <div className="relative">
                  <textarea
                    value={mindMapFeedback}
                    onChange={(e) => setMindMapFeedback(e.target.value)}
                    placeholder="지도를 보고 수정하고 싶은 내용이나 추가하고 싶은 아이디어를 말씀해주세요."
                    className="w-full bg-background border border-border rounded-2xl p-4 text-sm min-h-[100px] focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                  />
                  <button
                    onClick={handleRefineMindMap}
                    disabled={isGeneratingMindMap || !mindMapFeedback.trim()}
                    className="absolute bottom-3 right-3 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
                  >
                    {isGeneratingMindMap ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Send size={14} />}
                    지도 수정하기
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[10px] text-muted-foreground">
                    * 지도가 마음에 드신다면 '이대로 설계도 만들기'를 눌러주세요.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowMindMapModal(false)}
                      className="px-6 py-3 rounded-2xl text-sm font-bold hover:bg-muted transition-all"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleConfirmMindMap}
                      disabled={isGeneratingMindMap || !currentMindMap}
                      className="px-8 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all flex items-center gap-2"
                    >
                      <Check size={18} />
                      이대로 설계도 만들기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <ArchitectureRefinementModal
        isOpen={showRefinementModal}
        onClose={() => setShowRefinementModal(false)}
        blueprint={draftBlueprint}
        onRefine={handleRefineBlueprint}
        onFinalize={handleFinalizeBlueprint}
        isRefining={isRefiningBlueprint}
        isFinalizing={isFinalizingBlueprint}
        progressMessage={generationProgressMsg}
        insights={architectureInsights}
        isFetchingInsights={isFetchingInsights}
      />

      {/* Code Skeleton Modal */}
      {showSkeletonModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border shadow-2xl rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
                  <Code size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight">코드 스켈레톤 (Boilerplate)</h3>
                  <p className="text-xs text-muted-foreground">{selectedNoteForSkeleton?.title} 기능을 위한 초기 코드 구조입니다.</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowSkeletonModal(false);
                  setCodeSkeleton(null);
                }}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
              {isGeneratingSkeleton ? (
                <div className="h-64 flex flex-col items-center justify-center gap-4">
                  <Loader2 size={48} className="animate-spin text-primary/50" />
                  <p className="text-sm font-medium text-muted-foreground animate-pulse">코드 구조를 설계하는 중...</p>
                </div>
              ) : codeSkeleton && codeSkeleton.files ? (
                <div className="space-y-6">
                  {codeSkeleton.files.map((file: any, idx: number) => (
                    <div key={idx} className="bg-background border border-border rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-muted/50 px-4 py-2 border-b border-border flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{file.path}</span>
                        <button 
                          onClick={() => navigator.clipboard.writeText(file.content)}
                          className="text-[10px] font-bold hover:text-primary transition-colors"
                        >
                          COPY
                        </button>
                      </div>
                      <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed">
                        <code>{file.content}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                  <p>생성된 코드가 없습니다.</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-border bg-muted/30 flex justify-end">
              <button
                onClick={() => {
                  setShowSkeletonModal(false);
                  setCodeSkeleton(null);
                }}
                className="px-8 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all"
              >
                확인 완료
              </button>
            </div>
          </motion.div>
        </div>
      )}


      <KeywordInputModal 
        isOpen={showKeywordModal} 
        onClose={() => setShowKeywordModal(false)} 
        onConfirm={(k) => { setShowKeywordModal(false); performGeneration([k]); }} 
        title="키워드 입력" 
      />
      <SuggestedKeywordsModal 
        isOpen={showSuggestedModal} 
        onClose={() => setShowSuggestedModal(false)} 
        onConfirm={(ks) => { setShowSuggestedModal(false); performGeneration(ks); }} 
        title="키워드 선택" 
        suggestions={suggestedKeywords}
      />
    </div>
  );
};
