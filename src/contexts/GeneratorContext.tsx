import React, { createContext, useContext, useState, ReactNode } from 'react';
import { StrategyPillarOption, DomainCandidate } from '../types';

interface GeneratorContextType {
  currentStep: number;
  setCurrentStep: (step: number) => void;
  userInput: string;
  setUserInput: (input: string) => void;
  ptsOptions: StrategyPillarOption[];
  setPtsOptions: (options: StrategyPillarOption[]) => void;
  deepeningId: string | null;
  setDeepeningId: (id: string | null) => void;
  refineInput: string;
  setRefineInput: (input: string) => void;
  domains: DomainCandidate[];
  setDomains: (domains: DomainCandidate[]) => void;
  selectedDomainIdx: number;
  setSelectedDomainIdx: (idx: number) => void;
  domainRefineInput: string;
  setDomainRefineInput: (input: string) => void;
  domainSuggestions: string[];
  setDomainSuggestions: (suggestions: string[]) => void;
  modulesMap: Record<number, any[]>;
  setModulesMap: (map: Record<number, any[]>) => void;
  selectedModuleIdx: number;
  setSelectedModuleIdx: (idx: number) => void;
  moduleRefineInput: string;
  setModuleRefineInput: (input: string) => void;
  moduleSuggestionsMap: Record<string, string[]>;
  setModuleSuggestionsMap: (map: Record<string, string[]>) => void;
  logicsMap: Record<string, any[]>;
  setLogicsMap: (map: Record<string, any[]>) => void;
}

const GeneratorContext = createContext<GeneratorContextType | undefined>(undefined);

export const GeneratorProvider = ({ children }: { children: ReactNode }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [userInput, setUserInput] = useState('');
  const [ptsOptions, setPtsOptions] = useState<StrategyPillarOption[]>([]);
  const [deepeningId, setDeepeningId] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [domains, setDomains] = useState<DomainCandidate[]>([]);
  const [selectedDomainIdx, setSelectedDomainIdx] = useState(0);
  const [domainRefineInput, setDomainRefineInput] = useState('');
  const [domainSuggestions, setDomainSuggestions] = useState<string[]>([]);
  const [modulesMap, setModulesMap] = useState<Record<number, any[]>>({});
  const [selectedModuleIdx, setSelectedModuleIdx] = useState(0);
  const [moduleRefineInput, setModuleRefineInput] = useState('');
  const [moduleSuggestionsMap, setModuleSuggestionsMap] = useState<Record<string, string[]>>({});
  const [logicsMap, setLogicsMap] = useState<Record<string, any[]>>({});

  return (
    <GeneratorContext.Provider value={{
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
    }}>
      {children}
    </GeneratorContext.Provider>
  );
};

export const useGenerator = () => {
  const context = useContext(GeneratorContext);
  if (!context) throw new Error('useGenerator must be used within a GeneratorProvider');
  return context;
};
