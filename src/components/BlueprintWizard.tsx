import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Target, 
  Users, 
  Zap, 
  ArrowRight, 
  Check, 
  RotateCcw, 
  X, 
  MessageSquare, 
  Loader2, 
  ChevronRight, 
  ChevronDown,
  Layers, 
  Box, 
  Code2,
  Save,
  AlertCircle
} from 'lucide-react';
import { StrategyPillars, Note, StrategyPillarOption } from '../types';
import { 
  generateInitialPTS,
  generateMorePTS,
  deepDivePTS,
  refinePillars, 
  generateDomainsWithPillars, 
  generateMoreDomains,
  generateDomainForSpecificPts,
  splitDomain,
  deepenDomainPillars,
  generateModulesWithPillars, 
  generateLogicsForModule,
  refineDomains,
  refineModules,
  generateDomainRefinementSuggestions,
  generateModuleRefinementSuggestions,
  generateBulkModuleSuggestions,
  summarizeStrategicPillars,
  generateDetailedBlueprint
} from '../services/gemini';
import * as dbManager from '../services/dbManager';
import { saveNoteToSync } from '../services/syncManager';
import { useGenerator } from '../contexts/GeneratorContext';
import { useAuth } from '../contexts/AuthContext';

interface WizardStep {
  id: number;
  title: string;
  description: string;
}

const STEPS: WizardStep[] = [
  { id: 1, title: '아이디어 입력', description: '당신의 비전을 들려주세요.' },
  { id: 2, title: '핵심 전략 수립', description: '비즈니스의 본질을 정의합니다.' },
  { id: 3, title: '도메인 설계', description: '시스템의 거대한 뼈대를 잡습니다.' },
  { id: 4, title: '모듈 상세화', description: '사용자 경험 단위를 설계합니다.' }
];

export const BlueprintWizard = ({ 
  projectId, 
  initialIdea,
  onComplete, 
  onClose 
}: { 
  projectId: string, 
  initialIdea?: string,
  onComplete: () => void, 
  onClose: () => void 
}) => {
  const { user } = useAuth();
  const { 
    currentStep, setCurrentStep,
    userInput, setUserInput,
    ptsOptions, setPtsOptions,
    deepeningId, setDeepeningId,
    refineInput, setRefineInput,
    domains, setDomains,
    selectedDomainIdx, setSelectedDomainIdx,
    domainRefineInput, setDomainRefineInput,
    domainSuggestions, setDomainSuggestions,
    modulesMap, setModulesMap,
    selectedModuleIdx, setSelectedModuleIdx,
    moduleRefineInput, setModuleRefineInput,
    moduleSuggestionsMap, setModuleSuggestionsMap,
    logicsMap, setLogicsMap
  } = useGenerator();
  const [isLoading, setIsLoading] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showDomainMoreOptions, setShowDomainMoreOptions] = useState(false);
  const [isExpandingDomains, setIsExpandingDomains] = useState(false);
  const [splittingDomainId, setSplittingDomainId] = useState<string | null>(null);
  const [deepeningDomainId, setDeepeningDomainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');

  // Auto-start if initialIdea is provided
  React.useEffect(() => {
    if (initialIdea && currentStep === 1 && !isLoading && ptsOptions.length === 0) {
      handleNextStep();
    }
  }, [initialIdea]);

  const handleGenerateMoreDomains = async (mode: 'industry' | 'idea') => {
    setError(null);
    setIsExpandingDomains(true);
    try {
      const existingNotes = await dbManager.getNotesByProject(projectId);
      const selectedOptions = ptsOptions.filter(o => o.selected);
      const moreDomains = await generateMoreDomains(domains, selectedOptions, existingNotes, mode);
      setDomains([...domains, ...moreDomains]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExpandingDomains(false);
    }
  };

  const handleSplitDomain = async (domain: any) => {
    setError(null);
    setSplittingDomainId(domain.id);
    try {
      const splitDomains = await splitDomain(domain);
      // Replace the original domain with the split ones
      const nextDomains = domains.filter(d => d.id !== domain.id);
      setDomains([...nextDomains, ...splitDomains]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSplittingDomainId(null);
    }
  };

  const handleDeepenDomain = async (domain: any) => {
    setError(null);
    setDeepeningDomainId(domain.id);
    try {
      const deeper = await deepenDomainPillars(domain);
      const nextDomains = domains.map(d => 
        d.id === domain.id ? { ...d, boundaries: deeper.boundaries, kpis: deeper.kpis, glossary: deeper.glossary } : d
      );
      setDomains(nextDomains);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeepeningDomainId(null);
    }
  };

  const handleSuggestDomainForPts = async (pts: any) => {
    setError(null);
    setIsExpandingDomains(true);
    try {
      const existingNotes = await dbManager.getNotesByProject(projectId);
      const moreDomains = await generateDomainForSpecificPts(domains, pts, existingNotes);
      setDomains([...domains, ...moreDomains]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExpandingDomains(false);
    }
  };

  const handleNextStep = async (stepId?: number) => {
    setError(null);
    setIsLoading(true);
    const targetStep = stepId || currentStep;
    
    // Roll back currentStep immediately if re-running an upstream step
    if (stepId && stepId < currentStep) {
      setCurrentStep(stepId);
    }

    try {
      const existingNotes = await dbManager.getNotesByProject(projectId);

      if (targetStep === 1) {
        const options = await generateInitialPTS(userInput, existingNotes);
        setPtsOptions(options);
        // Clear downstream
        setDomains([]);
        setModulesMap({});
        setLogicsMap({});
        setDomainSuggestions([]);
        setModuleSuggestionsMap({});
        setCurrentStep(2);
      } else if (targetStep === 2) {
        const selectedOptions = ptsOptions.filter(o => o.selected);
        if (selectedOptions.length === 0) throw new Error("최소 하나의 전략을 선택해주세요.");
        
        // Clear downstream
        setDomains([]);
        setModulesMap({});
        setLogicsMap({});
        setDomainSuggestions([]);
        setModuleSuggestionsMap({});
        
        const result = await generateDomainsWithPillars(selectedOptions, existingNotes);
        setDomains(result.domains);
        const suggestions = await generateDomainRefinementSuggestions(result.domains);
        setDomainSuggestions(suggestions);
        setCurrentStep(3);
        setSelectedDomainIdx(0);
      } else if (targetStep === 3) {
        const selectedDomains = domains.filter(d => d.selected);
        if (selectedDomains.length === 0) throw new Error("최소 하나의 도메인을 선택해주세요.");
        
        // Update domains state to only keep selected ones
        setDomains(selectedDomains);
        
        const newModulesMap: Record<number, any[]> = {};
        const newSuggestionsMap: Record<string, string[]> = {};
        
        // Clear downstream
        setLogicsMap({});
        
        // Parallelize module and suggestion generation for all selected domains
        const domainResults = await Promise.all(selectedDomains.map(async (domain, i) => {
          const result = await generateModulesWithPillars(domain.title, domain, existingNotes);
          const bulkSuggestions = await generateBulkModuleSuggestions(domain.title, result.modules);
          return { i, modules: result.modules, suggestions: bulkSuggestions };
        }));

        domainResults.forEach(({ i, modules, suggestions }) => {
          newModulesMap[i] = modules;
          Object.entries(suggestions).forEach(([mIdx, s]) => {
            newSuggestionsMap[`${i}-${mIdx}`] = s as string[];
          });
        });
        
        setModulesMap(newModulesMap);
        setModuleSuggestionsMap(newSuggestionsMap);
        setCurrentStep(4);
      } else if (targetStep === 4) {
        // Ensure all logics are generated before finalizing
        const newLogicsMap = { ...logicsMap };
        const logicPromises: Promise<void>[] = [];

        for (let i = 0; i < domains.length; i++) {
          const domainModules = modulesMap[i] || [];
          for (let j = 0; j < domainModules.length; j++) {
            const key = `${i}-${j}`;
            if (!newLogicsMap[key] || newLogicsMap[key].length === 0) {
              const module = domainModules[j];
              logicPromises.push(
                generateLogicsForModule(module.title, module, existingNotes).then(result => {
                  newLogicsMap[key] = result.logics;
                })
              );
            }
          }
        }

        if (logicPromises.length > 0) {
          await Promise.all(logicPromises);
          setLogicsMap(newLogicsMap);
        }
        
        await handleFinalize(newLogicsMap);
      }
    } catch (err: any) {
      setError(err.message || '오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefineDomains = async (overrideInput?: string) => {
    const input = overrideInput || domainRefineInput;
    if (!domains.length || !input) return;
    setIsLoading(true);
    try {
      const existingNotes = await dbManager.getNotesByProject(projectId);
      const result = await refineDomains(domains, input, existingNotes);
      setDomains(result.domains);
      setDomainRefineInput('');
      const suggestions = await generateDomainRefinementSuggestions(result.domains);
      setDomainSuggestions(suggestions);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefineModules = async (overrideInput?: string) => {
    const input = overrideInput || moduleRefineInput;
    const currentModules = modulesMap[selectedDomainIdx];
    if (!currentModules || !input) return;
    setIsLoading(true);
    try {
      const existingNotes = await dbManager.getNotesByProject(projectId);
      const result = await refineModules(currentModules, input, existingNotes);
      const nextMap = { ...modulesMap };
      nextMap[selectedDomainIdx] = result.modules;
      setModulesMap(nextMap);
      setModuleRefineInput('');
      
      // Update suggestions for the refined modules
      const bulkSuggestions = await generateBulkModuleSuggestions(domains[selectedDomainIdx].title, result.modules);
      const nextSuggestionsMap = { ...moduleSuggestionsMap };
      Object.entries(bulkSuggestions).forEach(([mIdx, suggestions]) => {
        nextSuggestionsMap[`${selectedDomainIdx}-${mIdx}`] = suggestions as string[];
      });
      setModuleSuggestionsMap(nextSuggestionsMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefinePillars = async () => {
    const selected = ptsOptions.filter(o => o.selected);
    if (selected.length === 0 || !refineInput) return;
    setIsLoading(true);
    try {
      // For now, refine the first selected pillar as a simple implementation
      const refined = await refinePillars(selected[0], refineInput);
      const next = ptsOptions.map(o => o.id === selected[0].id ? { ...refined, id: o.id, selected: true } : o);
      setPtsOptions(next);
      setRefineInput('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalize = async (finalLogicsMap?: Record<string, any[]>) => {
    if (!user || !projectId) return;
    const targetLogicsMap = finalLogicsMap || logicsMap;
    setIsLoading(true);
    setProgressMsg('비즈니스 전략 요약 중...');
    try {
      const project = await dbManager.getProject(projectId);
      if (project) {
        const selectedOptions = ptsOptions.filter(o => o.selected);
        // Summarize PTS instead of just joining
        const summary = await summarizeStrategicPillars(selectedOptions);
        await dbManager.saveProject({
          ...project,
          painPoint: summary.painPoint,
          targetAudience: summary.targetAudience,
          solutionPromise: summary.solutionPromise
        });
      }

      // Build blueprint structure for detailed generation
      const blueprint = {
        domains: domains.map((domain, i) => ({
          ...domain,
          modules: (modulesMap[i] || []).map((mod, j) => ({
            ...mod,
            logics: targetLogicsMap[`${i}-${j}`] || []
          }))
        }))
      };

      setProgressMsg('설계도 정밀 분석 및 상세화 시작...');
      const detailed = await generateDetailedBlueprint(blueprint, (msg) => {
        setProgressMsg(msg);
      });

      for (const domain of detailed.domains) {
        const domainId = crypto.randomUUID();
        const domainNote: Note = {
          id: domainId,
          projectId,
          uid: user.uid,
          title: domain.title,
          summary: domain.summary,
          body: domain.content || domain.summary,
          noteType: 'Domain',
          status: 'Todo',
          priority: 'Medium',
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          parentNoteIds: [],
          childNoteIds: [],
          boundaries: domain.boundaries,
          kpis: domain.kpis,
          glossary: domain.glossary,
          painPoint: domain.painPoint,
          targetAudience: domain.targetAudience,
          solutionPromise: domain.solutionPromise
        };
        await saveNoteToSync(domainNote);

        const moduleIds: string[] = [];
        if (domain.modules) {
          for (const mod of domain.modules) {
            const moduleId = crypto.randomUUID();
            moduleIds.push(moduleId);

            const moduleNote: Note = {
              id: moduleId,
              projectId,
              uid: user.uid,
              title: mod.title,
              summary: mod.summary,
              body: mod.content || mod.summary,
              noteType: 'Module',
              status: 'Todo',
              priority: 'Medium',
              lastUpdated: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              parentNoteIds: [domainId],
              childNoteIds: [],
              requirements: mod.requirements,
              userJourney: mod.userJourney,
              ia: mod.ia,
              painPoint: mod.painPoint,
              targetAudience: mod.targetAudience,
              solutionPromise: mod.solutionPromise
            };
            await saveNoteToSync(moduleNote);

            const logicIds: string[] = [];
            if (mod.logics) {
              for (const logic of mod.logics) {
                const logicId = crypto.randomUUID();
                logicIds.push(logicId);

                const logicNote: Note = {
                  id: logicId,
                  projectId,
                  uid: user.uid,
                  title: logic.title,
                  summary: logic.summary,
                  body: logic.content || logic.summary,
                  noteType: 'Logic',
                  status: 'Todo',
                  priority: 'Medium',
                  lastUpdated: new Date().toISOString(),
                  createdAt: new Date().toISOString(),
                  parentNoteIds: [moduleId],
                  childNoteIds: [],
                  painPoint: logic.painPoint,
                  targetAudience: logic.targetAudience,
                  solutionPromise: logic.solutionPromise,
                  businessRules: logic.businessRules,
                  constraints: logic.constraints,
                  ioMapping: logic.ioMapping,
                  edgeCases: logic.edgeCases
                };
                await saveNoteToSync(logicNote);
              }
            }
            await saveNoteToSync({ ...moduleNote, childNoteIds: logicIds });
          }
        }
        await saveNoteToSync({ ...domainNote, childNoteIds: moduleIds });
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  };

  const renderPillarCard = (label: string, value: string, icon: React.ReactNode, color: string, onChange: (val: string) => void) => (
    <div className="bg-muted/30 border border-border rounded-2xl p-6 space-y-3 relative group overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${color} opacity-50 group-hover:opacity-100 transition-opacity`}></div>
      <div className="flex items-center gap-3 text-muted-foreground">
        {icon}
        <span className="text-xs font-black uppercase tracking-widest">{label}</span>
      </div>
      <textarea 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border-none outline-none text-sm font-bold leading-relaxed resize-none h-24 custom-scrollbar"
      />
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="w-full md:h-full flex flex-col relative"
    >
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6"
          >
            <div className="relative">
              <div className="w-20 h-20 border-4 border-primary/20 rounded-full"></div>
              <div className="absolute top-0 left-0 w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="text-primary animate-pulse" size={32} />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-black tracking-tight animate-pulse">AI 아키텍트가 설계 중...</h3>
              <p className="text-sm font-medium text-muted-foreground">{progressMsg || '잠시만 기다려주세요.'}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        {/* Stepper */}
        <div className="px-8 py-4 border-b border-border bg-muted/5 flex items-center justify-between overflow-x-auto custom-scrollbar gap-4">
          {STEPS.map((step) => (
            <div key={step.id} className="flex items-center gap-3 shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all ${
                currentStep >= step.id ? 'bg-primary text-primary-foreground glow-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {currentStep > step.id ? <Check size={14} /> : step.id}
              </div>
              <div className="hidden sm:block">
                <p className={`text-[10px] font-black uppercase tracking-widest ${currentStep >= step.id ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {step.title}
                </p>
              </div>
              {step.id < STEPS.length && <ChevronRight size={14} className="text-muted-foreground/30 hidden sm:block" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 md:overflow-y-auto p-8 sm:p-12 custom-scrollbar space-y-12">
          {STEPS.map((step) => {
            if (step.id > currentStep) return null;
            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-b border-border pb-12 last:border-0"
              >
                {step.id === 1 && (
                  <div className="max-w-2xl mx-auto space-y-8">
                    <div className="text-center space-y-4">
                      <h3 className="text-3xl font-black tracking-tight">당신의 아이디어는 무엇인가요?</h3>
                      <p className="text-muted-foreground leading-relaxed">
                        막연한 생각이라도 괜찮습니다. AI가 당신의 비즈니스 본질을 찾아낼 수 있도록 자유롭게 적어주세요.
                      </p>
                    </div>
                    <div className="relative">
                      <textarea 
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="예: 바쁜 직장인들을 위한 15분 밀키트 정기 구독 서비스..."
                        className="w-full h-64 bg-muted/30 border-2 border-border rounded-3xl p-8 text-lg font-medium outline-none focus:border-primary/50 transition-all resize-none custom-scrollbar"
                      />
                      <div className="absolute bottom-6 right-6">
                        <button 
                          onClick={() => handleNextStep(1)}
                          disabled={!userInput || isLoading}
                          className="bg-primary text-primary-foreground px-8 py-4 rounded-2xl font-black uppercase tracking-widest flex items-center gap-3 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 glow-primary"
                        >
                          {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                          전략 분석 시작
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {step.id === 2 && (
                  <div className="space-y-8">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-6">
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black tracking-tight">전략 탐구 및 조립</h3>
                        <p className="text-muted-foreground">마음에 드는 전략 조각들을 선택하여 당신만의 비즈니스 모델을 조립하세요.</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto relative">
                        <div className="relative group">
                          <button 
                            onClick={() => setShowMoreOptions(!showMoreOptions)}
                            disabled={isLoading}
                            className="bg-muted hover:bg-muted/80 px-6 py-4 md:py-3 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-50 w-full md:w-auto"
                          >
                            {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                            더 많이 보기 (수평 확장)
                            <ChevronDown size={16} className={`transition-transform ${showMoreOptions ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {showMoreOptions && (
                            <div className="absolute top-full left-0 mt-2 w-full md:w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                              <button
                                onClick={async () => {
                                  setShowMoreOptions(false);
                                  setIsLoading(true);
                                  try {
                                    const more = await generateMorePTS(ptsOptions, userInput, 'industry');
                                    setPtsOptions([...ptsOptions, ...more]);
                                  } catch (err: any) {
                                    setError(err.message);
                                  } finally {
                                    setIsLoading(false);
                                  }
                                }}
                                className="w-full px-4 py-3 text-left hover:bg-muted flex flex-col gap-1 transition-colors"
                              >
                                <span className="font-bold text-sm">1. 산업/분야 수평 확장</span>
                                <span className="text-xs text-muted-foreground">해당 분야의 보편적이고 강력한 전략 탐색</span>
                              </button>
                              <div className="h-px bg-border" />
                              <button
                                onClick={async () => {
                                  setShowMoreOptions(false);
                                  setIsLoading(true);
                                  try {
                                    const more = await generateMorePTS(ptsOptions, userInput, 'idea');
                                    setPtsOptions([...ptsOptions, ...more]);
                                  } catch (err: any) {
                                    setError(err.message);
                                  } finally {
                                    setIsLoading(false);
                                  }
                                }}
                                className="w-full px-4 py-3 text-left hover:bg-muted flex flex-col gap-1 transition-colors"
                              >
                                <span className="font-bold text-sm">2. 아이디어 심화 확장</span>
                                <span className="text-xs text-muted-foreground">초기 아이디어의 철학과 가치를 구체화</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => handleNextStep(2)}
                          disabled={isLoading || ptsOptions.filter(o => o.selected).length === 0}
                          className="bg-primary text-primary-foreground px-6 py-4 md:py-3 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all glow-primary disabled:opacity-50 w-full md:w-auto"
                        >
                          {isLoading ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                          다음 단계
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {ptsOptions.map((option) => (
                          <div 
                            key={option.id}
                            onClick={() => {
                              const next = ptsOptions.map(o => o.id === option.id ? { ...o, selected: !o.selected } : o);
                              setPtsOptions(next);
                            }}
                            className={`border-2 rounded-3xl p-6 space-y-4 transition-all relative cursor-pointer ${
                              option.selected ? 'border-primary bg-primary/5 shadow-lg' : 'border-border bg-muted/20 hover:border-primary/30'
                            }`}
                          >
                            <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Pain</p>
                              <p className="text-sm font-bold">{option.painPoint}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Target</p>
                              <p className="text-sm font-bold">{option.targetAudience}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Promise</p>
                              <p className="text-sm font-bold">{option.solutionPromise}</p>
                            </div>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                setDeepeningId(option.id);
                                try {
                                  const deeper = await deepDivePTS(option, userInput);
                                  setPtsOptions([...ptsOptions, ...deeper]);
                                } catch (err: any) {
                                  setError(err.message);
                                } finally {
                                  setDeepeningId(null);
                                }
                              }}
                              disabled={deepeningId !== null}
                              className="w-full text-xs font-black uppercase tracking-widest text-primary hover:underline flex items-center justify-center gap-2"
                            >
                              {deepeningId === option.id ? (
                                <>
                                  <Loader2 className="animate-spin" size={12} />
                                  쪼개는 중...
                                </>
                              ) : (
                                '더 깊게 쪼개기 (수직 확장)'
                              )}
                            </button>
                          </div>
                      ))}
                    </div>
                  </div>
                )}

                {step.id === 3 && (
                  <div className="space-y-8 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 shrink-0">
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black tracking-tight">도메인 구조 설계</h3>
                        <p className="text-muted-foreground">프로젝트를 구성하는 거대한 뼈대입니다. 필요한 도메인을 선택하고 조립하세요.</p>
                      </div>
                      <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                        <div className="relative w-full md:w-auto">
                          <button 
                            onClick={() => setShowDomainMoreOptions(!showDomainMoreOptions)}
                            disabled={isExpandingDomains}
                            className="bg-muted text-foreground px-6 py-4 md:py-3 rounded-xl font-black uppercase tracking-widest flex items-center justify-between md:justify-center gap-2 hover:bg-muted/80 transition-all w-full"
                          >
                            <div className="flex items-center gap-2">
                              {isExpandingDomains ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                              다른 관점 더 보기 (수평 확장)
                            </div>
                            <ChevronDown size={16} className={`transition-transform ${showDomainMoreOptions ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {showDomainMoreOptions && (
                            <div className="absolute top-full left-0 mt-2 w-full md:w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                              <button
                                onClick={async () => {
                                  setShowDomainMoreOptions(false);
                                  await handleGenerateMoreDomains('industry');
                                }}
                                className="w-full px-4 py-3 text-left hover:bg-muted flex flex-col gap-1 transition-colors"
                              >
                                <span className="font-bold text-sm">1. 산업/분야 수평 확장</span>
                                <span className="text-xs text-muted-foreground">해당 분야의 보편적이고 강력한 전략 탐색</span>
                              </button>
                              <div className="h-px bg-border" />
                              <button
                                onClick={async () => {
                                  setShowDomainMoreOptions(false);
                                  await handleGenerateMoreDomains('idea');
                                }}
                                className="w-full px-4 py-3 text-left hover:bg-muted flex flex-col gap-1 transition-colors"
                              >
                                <span className="font-bold text-sm">2. 아이디어 심화 확장</span>
                                <span className="text-xs text-muted-foreground">초기 아이디어의 철학과 가치를 구체화</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => handleNextStep(3)}
                          disabled={isLoading || domains.filter(d => d.selected).length === 0}
                          className="bg-primary text-primary-foreground px-6 py-4 md:py-3 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all glow-primary w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isLoading ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                          모듈 상세화 진행
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden min-h-0">
                      {/* PTS Coverage Dashboard */}
                      <div className="lg:col-span-3 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                        <h4 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">PTS Coverage</h4>
                        <div className="space-y-3">
                          {ptsOptions.filter(p => p.selected).map(pts => {
                            const coveringDomains = domains.filter(d => d.selected && d.coveredPtsIds?.includes(pts.id));
                            const isCovered = coveringDomains.length > 0;
                            return (
                              <div 
                                key={pts.id} 
                                onClick={() => {
                                  if (!isCovered && !isExpandingDomains) {
                                    handleSuggestDomainForPts(pts);
                                  }
                                }}
                                className={`p-4 rounded-xl border-2 transition-all ${isCovered ? 'border-green-500/50 bg-green-500/5' : 'border-amber-500/50 bg-amber-500/5 cursor-pointer hover:border-amber-500 hover:bg-amber-500/10'}`}
                                title={isCovered ? `해결 도메인: ${coveringDomains.map(d => d.title).join(', ')}` : '클릭하여 이 전략을 해결할 도메인 추천받기'}
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  {isCovered ? <Check size={14} className="text-green-500" /> : <AlertCircle size={14} className="text-amber-500" />}
                                  <span className={`text-xs font-bold ${isCovered ? 'text-green-500' : 'text-amber-500'}`}>
                                    {isCovered ? '반영됨' : '미반영 (클릭하여 추천받기)'}
                                  </span>
                                </div>
                                <p className="text-xs font-medium line-clamp-2">{pts.solutionPromise}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Domain Candidates Grid */}
                      <div className="lg:col-span-9 bg-muted/20 border border-border rounded-[2rem] p-6 overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {domains.map((domain) => (
                            <div 
                              key={domain.id}
                              onClick={() => {
                                const next = domains.map(d => d.id === domain.id ? { ...d, selected: !d.selected } : d);
                                setDomains(next);
                              }}
                              className={`border-2 rounded-3xl p-6 space-y-4 transition-all relative cursor-pointer flex flex-col ${
                                domain.selected ? 'border-primary bg-primary/5 shadow-lg' : 'border-border bg-muted/20 hover:border-primary/30'
                              }`}
                            >
                              <div className="space-y-2 flex-1">
                                <h4 className="text-lg font-black tracking-tight">{domain.title}</h4>
                                <p className="text-sm text-muted-foreground">{domain.summary}</p>
                                <div className="pt-4 space-y-2">
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Pain</p>
                                    <p className="text-xs font-medium">{domain.painPoint}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Target</p>
                                    <p className="text-xs font-medium">{domain.targetAudience}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Promise</p>
                                    <p className="text-xs font-medium">{domain.solutionPromise}</p>
                                  </div>
                                </div>
                                {/* Pillar Deepening Results */}
                                {(domain.boundaries || domain.kpis || domain.glossary) && (
                                  <div className="pt-4 space-y-2 border-t border-border/50 mt-4">
                                    {domain.boundaries && (
                                      <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Boundaries</p>
                                        <p className="text-xs text-muted-foreground line-clamp-2">{domain.boundaries}</p>
                                      </div>
                                    )}
                                    {domain.kpis && (
                                      <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">KPIs</p>
                                        <p className="text-xs text-muted-foreground line-clamp-2">{domain.kpis}</p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="pt-4 border-t border-border flex justify-between items-center gap-2">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    handleSplitDomain(domain);
                                  }}
                                  disabled={splittingDomainId !== null}
                                  className="text-xs font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-1"
                                >
                                  {splittingDomainId === domain.id ? (
                                    <><Loader2 className="animate-spin" size={12} /> 쪼개는 중...</>
                                  ) : (
                                    '이 도메인 쪼개기 (수직 확장)'
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {step.id === 4 && (
                  <div className="space-y-8 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 shrink-0">
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black tracking-tight">모듈 상세 설계</h3>
                        <p className="text-muted-foreground">각 도메인을 구현하기 위한 구체적인 기능 단위입니다.</p>
                      </div>
                      <button 
                        onClick={() => handleNextStep(4)}
                        disabled={isLoading}
                        className="bg-primary text-primary-foreground px-6 py-4 md:py-3 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all glow-primary w-full md:w-auto"
                      >
                        {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        설계 완료 및 저장
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 overflow-hidden min-h-0">
                      <div className="lg:col-span-3 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
                        {domains.map((domain, dIdx) => (
                          <div key={dIdx} className="space-y-2">
                            <div className="flex items-center gap-2 px-2 py-1">
                              <Layers size={12} className="text-primary/50" />
                              <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">{domain.title}</h4>
                            </div>
                            <div className="space-y-1">
                              {(modulesMap[dIdx] || []).map((module, mIdx) => (
                                <button
                                  key={mIdx}
                                  onClick={() => {
                                    setSelectedDomainIdx(dIdx);
                                    setSelectedModuleIdx(mIdx);
                                  }}
                                  className={`w-full text-left p-4 rounded-xl border transition-all flex items-center gap-4 group ${
                                    selectedDomainIdx === dIdx && selectedModuleIdx === mIdx
                                      ? 'bg-primary/10 border-primary text-primary shadow-md' 
                                      : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50'
                                  }`}
                                >
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    selectedDomainIdx === dIdx && selectedModuleIdx === mIdx ? 'bg-primary/20' : 'bg-muted'
                                  }`}>
                                    <Box size={14} />
                                  </div>
                                  <span className="text-xs font-bold truncate">{module.title}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="lg:col-span-9 bg-muted/20 border border-border rounded-[2rem] p-10 space-y-10 overflow-y-auto custom-scrollbar">
                        {modulesMap[selectedDomainIdx]?.[selectedModuleIdx] && (
                          <div className="space-y-10">
                            <div className="space-y-4">
                              <div className="flex items-center gap-3 text-primary/60">
                                <Box size={16} />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Module Detailing</span>
                              </div>
                              <input 
                                value={modulesMap[selectedDomainIdx][selectedModuleIdx].title}
                                onChange={(e) => {
                                  const next = { ...modulesMap };
                                  next[selectedDomainIdx][selectedModuleIdx].title = e.target.value;
                                  setModulesMap(next);
                                }}
                                className="text-4xl font-black bg-transparent border-none outline-none w-full tracking-tight focus:text-primary transition-colors"
                                placeholder="모듈 제목"
                              />
                              <textarea 
                                value={modulesMap[selectedDomainIdx][selectedModuleIdx].summary}
                                onChange={(e) => {
                                  const next = { ...modulesMap };
                                  next[selectedDomainIdx][selectedModuleIdx].summary = e.target.value;
                                  setModulesMap(next);
                                }}
                                className="text-lg text-muted-foreground bg-transparent border-none outline-none w-full resize-none h-20 font-medium leading-relaxed"
                                placeholder="모듈에 대한 설명을 입력하세요..."
                              />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              {renderPillarCard('Module Pain', modulesMap[selectedDomainIdx][selectedModuleIdx].painPoint, <Target size={16} />, 'bg-red-500', (val) => {
                                const next = { ...modulesMap };
                                next[selectedDomainIdx][selectedModuleIdx].painPoint = val;
                                setModulesMap(next);
                              })}
                              {renderPillarCard('Module People', modulesMap[selectedDomainIdx][selectedModuleIdx].targetAudience, <Users size={16} />, 'bg-blue-500', (val) => {
                                const next = { ...modulesMap };
                                next[selectedDomainIdx][selectedModuleIdx].targetAudience = val;
                                setModulesMap(next);
                              })}
                              {renderPillarCard('Module Promise', modulesMap[selectedDomainIdx][selectedModuleIdx].solutionPromise, <Zap size={16} />, 'bg-amber-500', (val) => {
                                const next = { ...modulesMap };
                                next[selectedDomainIdx][selectedModuleIdx].solutionPromise = val;
                                setModulesMap(next);
                              })}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-border/50">
                              <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Requirements</label>
                                <textarea 
                                  value={modulesMap[selectedDomainIdx][selectedModuleIdx].requirements}
                                  onChange={(e) => {
                                    const next = { ...modulesMap };
                                    next[selectedDomainIdx][selectedModuleIdx].requirements = e.target.value;
                                    setModulesMap(next);
                                  }}
                                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 text-sm font-bold resize-none h-24 outline-none focus:border-primary/30 transition-all"
                                  placeholder="기능적 요구사항..."
                                />
                              </div>
                              <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">User Journey</label>
                                <textarea 
                                  value={modulesMap[selectedDomainIdx][selectedModuleIdx].userJourney}
                                  onChange={(e) => {
                                    const next = { ...modulesMap };
                                    next[selectedDomainIdx][selectedModuleIdx].userJourney = e.target.value;
                                    setModulesMap(next);
                                  }}
                                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 text-sm font-bold resize-none h-24 outline-none focus:border-primary/30 transition-all"
                                  placeholder="사용자 여정 시나리오..."
                                />
                              </div>
                              <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Information Architecture</label>
                                <textarea 
                                  value={modulesMap[selectedDomainIdx][selectedModuleIdx].ia}
                                  onChange={(e) => {
                                    const next = { ...modulesMap };
                                    next[selectedDomainIdx][selectedModuleIdx].ia = e.target.value;
                                    setModulesMap(next);
                                  }}
                                  className="w-full bg-muted/30 border border-border rounded-2xl p-4 text-sm font-bold resize-none h-24 outline-none focus:border-primary/30 transition-all"
                                  placeholder="데이터 객체 및 관계..."
                                />
                              </div>
                            </div>

                            <div className="space-y-6 pt-6 border-t border-border/50">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-primary/60">
                                  <Code2 size={16} />
                                  <span className="text-[10px] font-black uppercase tracking-[0.2em]">Core Rules & Data (Logics)</span>
                                </div>
                                {!logicsMap[`${selectedDomainIdx}-${selectedModuleIdx}`] && (
                                  <button
                                    onClick={async () => {
                                      setIsLoading(true);
                                      try {
                                        const module = modulesMap[selectedDomainIdx][selectedModuleIdx];
                                        const existingNotes = await dbManager.getNotesByProject(projectId);
                                        const result = await generateLogicsForModule(module.title, module, existingNotes);
                                        setLogicsMap({
                                          ...logicsMap,
                                          [`${selectedDomainIdx}-${selectedModuleIdx}`]: result.logics
                                        });
                                      } catch (err: any) {
                                        setError(err.message);
                                      } finally {
                                        setIsLoading(false);
                                      }
                                    }}
                                    disabled={isLoading}
                                    className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-2"
                                  >
                                    {isLoading ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />}
                                    로직 생성하기
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {(logicsMap[`${selectedDomainIdx}-${selectedModuleIdx}`] || []).map((logic, lIdx) => (
                                  <div key={lIdx} className="bg-muted/30 border border-border rounded-2xl p-6 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <h5 className="text-sm font-black">{logic.title}</h5>
                                      <span className="text-[10px] font-bold opacity-40 uppercase">Logic {lIdx + 1}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{logic.summary}</p>
                                    <div className="pt-2 space-y-2">
                                      <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Business Rules</div>
                                      <p className="text-[10px] line-clamp-2 opacity-70">{logic.businessRules}</p>
                                    </div>
                                  </div>
                                ))}
                                {isLoading && !logicsMap[`${selectedDomainIdx}-${selectedModuleIdx}`] && (
                                  <div className="col-span-full py-12 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                                    <Loader2 className="animate-spin" size={32} />
                                    <p className="text-sm font-bold">핵심 로직을 설계하고 있습니다...</p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="space-y-4">
                              {moduleSuggestionsMap[`${selectedDomainIdx}-${selectedModuleIdx}`]?.length > 0 && (
                                <div className="flex flex-wrap gap-2 px-1">
                                  {moduleSuggestionsMap[`${selectedDomainIdx}-${selectedModuleIdx}`].map((suggestion, i) => (
                                    <button
                                      key={i}
                                      onClick={() => handleRefineModules(suggestion)}
                                      disabled={isLoading}
                                      className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-full text-[10px] font-bold transition-all border border-primary/20"
                                    >
                                      {suggestion}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 flex items-center gap-4">
                                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary shrink-0">
                                  <MessageSquare size={20} />
                                </div>
                                <input 
                                  type="text" 
                                  value={moduleRefineInput}
                                  onChange={(e) => setModuleRefineInput(e.target.value)}
                                  placeholder="모듈 구조 수정을 요청하세요..."
                                  className="flex-1 bg-transparent border-none outline-none text-sm font-bold"
                                  onKeyDown={(e) => e.key === 'Enter' && handleRefineModules()}
                                />
                                <button 
                                  onClick={() => handleRefineModules()}
                                  disabled={!moduleRefineInput || isLoading}
                                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50"
                                >
                                  요청
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Footer Error */}
        {error && (
          <div className="px-8 py-4 bg-destructive/10 border-t border-destructive/20 flex items-center gap-3 text-destructive text-xs font-bold">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </motion.div>
  );
};
