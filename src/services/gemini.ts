import { GoogleGenAI, Type } from "@google/genai";
import { Note, ProactiveNudge, MindMap, StrategyPillars, StrategyPillarOption, DomainCandidate } from "../types";
import { withTimeout } from "../lib/utils";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Override generateContent with exponential backoff retry logic
const originalGenerateContent = ai.models.generateContent.bind(ai.models);
ai.models.generateContent = async (params: any) => {
  let attempt = 0;
  const maxAttempts = 8;
  while (attempt < maxAttempts) {
    try {
      return await originalGenerateContent(params);
    } catch (error: any) {
      attempt++;
      if (error?.status === 503 || error?.status === 429 || error?.message?.includes('503') || error?.message?.includes('429')) {
        if (attempt >= maxAttempts) throw error;
        // Increase base delay significantly to handle severe rate limiting
        const delay = Math.pow(2, attempt) * 3000 + Math.random() * 3000;
        console.warn(`Gemini API error (${error.status || 'unknown'}), retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries reached");
};

const MODEL = "gemini-2.5-flash-lite";
const PRO_MODEL = "gemini-2.5-flash-lite";

// Phase 1+: Mirroring Refinement (지도를 바탕으로 아이디어 수정)
export const refineMindMap = async (currentMindMap: MindMap, feedback: string) => {
  const prompt = `당신은 사용자의 피드백을 반영하여 생각의 지도를 실시간으로 수정하는 전문가입니다.

[현재 생각의 지도]
${JSON.stringify(currentMindMap, null, 2)}

[사용자 피드백]
${feedback}

[작성 지침]
1. 사용자의 피드백을 반영하여 노드를 추가, 삭제, 수정하거나 위치를 변경하세요.
2. 수정된 전체 지도를 다시 JSON 형식으로 반환하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "summary": "수정된 생각의 지도 요약",
  "nodes": [...]
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to refine mind map", e);
    return currentMindMap;
  }
};

// Phase 2+: Architecture Insights (Devil's Advocate)
export const generateArchitectureInsights = async (blueprint: any) => {
  const prompt = `당신은 비즈니스 아키텍처의 허점을 찾아내고 현실적인 제언을 하는 '악마의 대변인(Devil's Advocate)'이자 기술 코파운더입니다.
제시된 설계도를 분석하여 3가지 핵심 인사이트를 제공하세요.

[현재 설계도]
${JSON.stringify(blueprint, null, 2)}

[작성 지침]
1. '현실적 제약(Constraint)', '잠재적 위험(Risk)', '확장성 제언(Scalability)' 3가지 관점에서 분석하세요.
2. 무조건 칭찬하지 말고, 비판적이고 현실적인 시각을 유지하세요.
3. 각 인사이트는 제목과 상세 설명으로 구성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "insights": [
    {
      "type": "constraint | risk | scalability",
      "title": "인사이트 제목",
      "description": "상세 설명 및 대안 제언"
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to generate architecture insights", e);
    return { insights: [] };
  }
};

// Phase 3+: Code Skeleton Generation
export const generateCodeSkeleton = async (note: Note) => {
  const prompt = `당신은 설계도를 바탕으로 실제 개발에 필요한 Boilerplate 코드를 생성하는 기술 코파운더입니다.
제시된 노드의 내용을 분석하여 TypeScript 인터페이스와 서비스 구조를 생성하세요.

[노드 정보]
타입: ${note.noteType}
제목: ${note.title}
요약: ${note.summary}
상세 내용: ${note.body}

[작성 지침]
1. TypeScript를 사용하세요.
2. 실제 구현보다는 인터페이스(Interface), 타입(Type), 그리고 함수 시그니처(Function Signature) 위주로 작성하세요.
3. 주석을 통해 각 부분의 역할을 설명하세요.
4. 파일 구조 제안을 포함하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "files": [
    {
      "path": "src/types/...",
      "content": "..."
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to generate code skeleton", e);
    return { files: [] };
  }
};

export const generateInitialBlueprint = async (businessIdea: string) => {
  const prompt = `당신은 비전공자 창업자를 돕는 세계 최고의 비즈니스 파트너이자 기술 가이드입니다.
사용자의 비즈니스 아이디어를 바탕으로 서비스의 초기 설계도(Blueprint)를 작성하세요.

[사용자 아이디어]
${businessIdea}

[작성 지침 - 매우 중요]
1. 비전공자도 한눈에 이해할 수 있도록 아주 쉬운 일상 언어를 사용하세요.
2. '도메인', '모듈', '로직', 'DB', 'API', '캐싱' 같은 기술 용어는 절대 사용하지 마세요.
   - Domain -> '주요 영역' (예: '사용자 정보와 로그인')
   - Module -> '세부 기능' (예: '프로필 편집하기')
   - Logic -> '핵심 규칙' (예: '사진 용량 줄여서 저장하기')
3. 각 항목의 제목과 요약은 '이 기능이 왜 필요한지'와 '사용자가 얻는 이득'이 드러나게 작성하세요.
4. **구조의 풍부함**: 아이디어의 잠재력을 최대한 끌어내어, 비즈니스가 실제로 작동하기 위해 필요한 모든 측면을 고려하세요. 
   - 단순히 1~2개의 영역이 아니라, 사용자 경험, 운영 관리, 데이터 분석, 마케팅 등 다양한 관점에서 '주요 영역(Domain)'을 도출하세요.
   - 각 영역 내에서도 서비스의 완성도를 높일 수 있는 '세부 기능(Module)'과 '핵심 규칙(Logic)'을 충분히 구성하세요.
   - 구조가 부실하지 않도록, 실제 상용 서비스 수준의 체계적인 설계를 지향하세요.
5. 구조는 반드시 domains -> modules -> logics 계층 구조여야 합니다.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "modules": [
        {
          "title": "...",
          "summary": "...",
          "logics": [
            {
              "title": "...",
              "summary": "..."
            }
          ]
        }
      ]
    }
  ]
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          domains: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                modules: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      logics: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                            summary: { type: Type.STRING }
                          },
                          required: ["title", "summary"]
                        }
                      }
                    },
                    required: ["title", "summary", "logics"]
                  }
                }
              },
              required: ["title", "summary", "modules"]
            }
          }
        },
        required: ["domains"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: "{}" } as any);

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to generate blueprint", e);
    return { domains: [] };
  }
};

// Phase 1: 로직 단위 추출
export const extractLogicUnits = async (filePath: string, fileContent: string) => {
  const prompt = `다음 소스 코드 파일에서 '원자적 로직 단위'(함수, 클래스, 주요 블록 등)를 추출하세요.

[핵심 규칙: 단일 책임 원칙(SRP) 기반의 원자적 분리]
1. 단순히 함수나 클래스 단위로 1:1 추출하지 마세요.
2. 하나의 거대한 함수(예: completeOrder) 내부에 여러 개의 독립적인 비즈니스 로직(예: 1. 결제 승인, 2. 재고 차감, 3. 영수증 발송)이 혼재되어 있다면, 이를 반드시 개별적인 원자적 로직 단위로 쪼개어 여러 개로 추출하세요.
3. 각 추출된 단위는 오직 '단 하나의 핵심 기능'만 수행해야 합니다.
4. 식별자(title)는 원본 영문 식별자를 기본으로 하되, 하나의 함수를 여러 개로 쪼갠 경우 해당 역할을 명확히 알 수 있도록 접미사를 달아주세요. (예: completeOrder_approvePayment, completeOrder_deductInventory)

File Path: ${filePath}

Code:
\`\`\`
${fileContent}
\`\`\`
`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "로직 단위의 이름 (함수명, 클래스명 등)" },
            priority: { type: Type.STRING, description: "우선순위: 1st, 2nd, 3rd, 또는 Done" }
          },
          required: ["title", "priority"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" });

  try {
    const result = JSON.parse(response.text || "[]");
    return Array.isArray(result) ? result : [];
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
};

// Phase 2: AI 심층 분석
export const analyzeLogicUnit = async (title: string, codeSnippet: string) => {
  const prompt = `다음 소스 코드에서 '${title}' 로직 단위를 심층 분석하세요.
(주의: '${title}'이 특정 함수의 일부분(예: 함수명_세부기능)을 가리킨다면, 전체 함수가 아닌 해당 '세부 기능'에 대해서만 집중적으로 분석하세요.)
반드시 한국어로 작성해야 합니다.

가독성을 극대화하기 위해 다음 규칙을 엄격히 준수하세요:
1. 모든 항목은 마크다운(Markdown) 형식을 사용하세요.
2. 리스트 항목 사이에는 **반드시 빈 줄(Empty Line)을 하나씩 삽입**하세요.
3. 전문 용어는 가급적 그대로 사용하되, 설명은 친절하게 작성하세요.

다음 6가지 항목을 추출하세요:
1. title (제목): 이 로직 단위를 가장 잘 설명하는 직관적인 제목.
2. summary (요약): 이 로직 단위가 하는 일을 한 줄로 요약.
3. technicalRole (기술적 역할): 이 코드 조각의 기술적인 핵심 기능과 역할을 한 문장으로 정의하세요.
4. implementation (구현 상세): 코드의 실제 구현 방식, 알고리즘, 주요 로직을 상세히 설명하세요.
5. dependencies (의존성): 이 코드가 의존하고 있는 라이브러리, 외부 함수, 상태, 환경 변수 등을 나열하세요.
6. executionFlow (실행 흐름): 코드의 실제 실행 순서와 데이터가 변하는 과정을 번호를 매겨 상세히 기록하세요.

Code:
\`\`\`
${codeSnippet}
\`\`\`
`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          technicalRole: { type: Type.STRING, description: "기술적 역할 요약" },
          implementation: { type: Type.STRING, description: "구현 상세 설명" },
          dependencies: { type: Type.STRING, description: "기술적 의존성" },
          executionFlow: { type: Type.STRING, description: "데이터/실행 흐름" }
        },
        required: ["title", "summary", "technicalRole", "implementation", "dependencies", "executionFlow"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);

  try {
    const result = JSON.parse(response.text || "{}");
    if (!result.technicalRole) {
      return { title: title, summary: "", technicalRole: "", implementation: "", dependencies: "", executionFlow: "" };
    }
    return result;
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return { title: title, summary: "", technicalRole: "", implementation: "", dependencies: "", executionFlow: "" };
  }
};

// Re-format existing note for better readability
export const reformatNote = async (note: Partial<Note>) => {
  let prompt = `다음 노트를 가독성 있게 재구성하세요.
반드시 한국어로 작성해야 합니다.

가독성을 극대화하기 위해 다음 규칙을 엄격히 준수하세요:
1. 모든 항목은 마크다운(Markdown) 형식을 사용하세요.
2. 리스트 항목 사이에는 **반드시 빈 줄(Empty Line)을 하나씩 삽입**하세요.

기존 내용:
Type: ${note.noteType}
Title: ${note.title}
Summary: ${note.summary}
`;

  let properties: any = {
    summary: { type: Type.STRING }
  };
  let required: string[] = ["summary"];

  if (note.noteType === 'Domain') {
    prompt += `Pain Point: ${note.painPoint}\nTarget Audience: ${note.targetAudience}\nSolution Promise: ${note.solutionPromise}\nBoundaries: ${note.boundaries}\nKPIs: ${note.kpis}\nGlossary: ${note.glossary}`;
    prompt += `\n\n[Domain 작성 지침]
1. summary: 도메인의 정체성을 한 문장으로 정의
2. painPoint, targetAudience, solutionPromise: **리스트(- )를 사용하지 말고**, 핵심을 관통하는 **단 하나의 간결한 문장**으로만 작성하세요.
3. boundaries, kpis, glossary: 리스트(- ) 형식을 사용하고 항목 사이에 빈 줄을 넣으세요.`;
    properties = { 
      ...properties, 
      painPoint: { type: Type.STRING }, 
      targetAudience: { type: Type.STRING }, 
      solutionPromise: { type: Type.STRING }, 
      boundaries: { type: Type.STRING }, 
      kpis: { type: Type.STRING },
      glossary: { type: Type.STRING }
    };
    required = [...required, "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary"];
  } else if (note.noteType === 'Module') {
    prompt += `Pain Point: ${note.painPoint}\nTarget Audience: ${note.targetAudience}\nSolution Promise: ${note.solutionPromise}\nRequirements: ${note.requirements}\nUser Journey: ${note.userJourney}\nIA: ${note.ia}`;
    prompt += `\n\n[Module 작성 지침]
1. summary: 모듈의 핵심 역할을 한 문장으로 정의
2. painPoint, targetAudience, solutionPromise: **리스트(- )를 사용하지 말고**, 핵심을 관통하는 **단 하나의 간결한 문장**으로만 작성하세요.
3. requirements, userJourney, ia: 리스트(- ) 형식을 사용하고 항목 사이에 빈 줄을 넣으세요.`;
    properties = { 
      ...properties, 
      painPoint: { type: Type.STRING }, 
      targetAudience: { type: Type.STRING }, 
      solutionPromise: { type: Type.STRING }, 
      requirements: { type: Type.STRING }, 
      userJourney: { type: Type.STRING }, 
      ia: { type: Type.STRING } 
    };
    required = [...required, "painPoint", "targetAudience", "solutionPromise", "requirements", "userJourney", "ia"];
  } else if (note.noteType === 'Logic') {
    prompt += `Pain Point: ${note.painPoint}\nTarget Audience: ${note.targetAudience}\nSolution Promise: ${note.solutionPromise}\nBusiness Rules: ${note.businessRules}\nConstraints: ${note.constraints}\nIO Mapping: ${note.ioMapping}\nEdge Cases: ${note.edgeCases}`;
    prompt += `\n\n[Logic 작성 지침]
1. summary: 로직의 목적을 한 문장으로 정의
2. painPoint, targetAudience, solutionPromise: **리스트(- )를 사용하지 말고**, 핵심을 관통하는 **단 하나의 간결한 문장**으로만 작성하세요.
3. businessRules, constraints, ioMapping, edgeCases: 리스트(- ) 형식을 사용하고 항목 사이에 빈 줄을 넣으세요.`;
    properties = { 
      ...properties, 
      painPoint: { type: Type.STRING }, 
      targetAudience: { type: Type.STRING }, 
      solutionPromise: { type: Type.STRING }, 
      businessRules: { type: Type.STRING }, 
      constraints: { type: Type.STRING }, 
      ioMapping: { type: Type.STRING }, 
      edgeCases: { type: Type.STRING } 
    };
    required = [...required, "painPoint", "targetAudience", "solutionPromise", "businessRules", "constraints", "ioMapping", "edgeCases"];
  } else if (note.noteType === 'Snapshot') {
    prompt += `Technical Role: ${note.technicalRole}\nImplementation: ${note.implementation}\nDependencies: ${note.dependencies}\nExecution Flow: ${note.executionFlow}`;
    properties = { ...properties, technicalRole: { type: Type.STRING }, implementation: { type: Type.STRING }, dependencies: { type: Type.STRING }, executionFlow: { type: Type.STRING } };
    required = [...required, "technicalRole", "implementation", "dependencies", "executionFlow"];
  }

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties,
        required
      }
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return note;
  }
};

// Translate technical Snapshot data to Business Logic data
export const translateToBusinessLogic = async (technicalData: { 
  title: string, 
  summary: string, 
  technicalRole: string, 
  implementation: string, 
  dependencies: string, 
  executionFlow: string 
}) => {
  const prompt = `다음은 코드의 기술적 분석 내용(Snapshot)입니다. 이를 비전공자 개발자가 이해할 수 있는 '비즈니스 로직(의도)'으로 번역하세요.

가독성을 극대화하기 위해 다음 규칙을 엄격히 준수하세요:
1. 모든 항목은 마크다운(Markdown) 형식을 사용하세요.
2. 리스트 항목 사이에는 **반드시 빈 줄(Empty Line)을 하나씩 삽입**하세요.

번역 규칙:
0. 제목(title): '서비스 명칭 + 핵심 가치' (사용자 경험/체험 중심) 형식으로 작성하되, 단일 책임 원칙에 따라 '가장 핵심적인 단 하나의 가치'만 명시하세요. 'A 및 B', 'A와 B'처럼 여러 기능을 나열하지 마세요. 수식어를 빼고 무엇을 하는 기능인지만 명확히 합니다. (예: '중복 방지 폴더 생성', '실시간 재고 반영', '사용자 인증 시스템')
1. painPoint (사용자 고통): 이 로직이 해결하려는 핵심적인 사용자 불편함. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
2. targetAudience (타겟 사용자): 이 로직의 주요 사용자 층. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
3. solutionPromise (해결 가설): 이 로직이 제공하는 핵심 가치 제안. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
4. businessRules (비즈니스 규칙): 코드가 구현하고 있는 핵심 비즈니스 로직과 정책.
5. constraints (제약 사항): 비즈니스적으로 허용되지 않거나 제한해야 하는 조건.
6. ioMapping (입출력 매핑): 사용자의 입력이 비즈니스 결과물로 어떻게 변환되는지.
7. edgeCases (예외 상황): 비즈니스적으로 고려해야 할 특수 상황이나 오류 처리.

기술적 데이터:
제목: ${technicalData.title}
요약: ${technicalData.summary}
기술적 역할: ${technicalData.technicalRole}
구현 상세: ${technicalData.implementation}
의존성: ${technicalData.dependencies}
실행 흐름: ${technicalData.executionFlow}
`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "비즈니스 친화적인 직관적인 한국어 제목" },
          summary: { type: Type.STRING, description: "비즈니스 요약" },
          painPoint: { type: Type.STRING, description: "사용자 고통 (단일 문장)" },
          targetAudience: { type: Type.STRING, description: "타겟 사용자 (단일 문장)" },
          solutionPromise: { type: Type.STRING, description: "해결 가설 (단일 문장)" },
          businessRules: { type: Type.STRING, description: "비즈니스 규칙" },
          constraints: { type: Type.STRING, description: "제약 사항" },
          ioMapping: { type: Type.STRING, description: "입출력 매핑" },
          edgeCases: { type: Type.STRING, description: "예외 상황" }
        },
        required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "businessRules", "constraints", "ioMapping", "edgeCases"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" });

  try {
    const result = JSON.parse(response.text || "{}");
    if (!result.title) {
      return {
        title: technicalData.title || "Untitled",
        summary: technicalData.summary || "",
        painPoint: "",
        targetAudience: "",
        solutionPromise: "",
        businessRules: "",
        constraints: "",
        ioMapping: "",
        edgeCases: ""
      };
    }
    return result;
  } catch (e) {
    console.error("Failed to translate to business logic", e);
    return {
      title: technicalData.title || "Untitled",
      summary: technicalData.summary || "",
      painPoint: "",
      targetAudience: "",
      solutionPromise: "",
      businessRules: "",
      constraints: "",
      ioMapping: "",
      edgeCases: ""
    };
  }
};

export const checkImplementationConflict = async (
  implementedLogic: { title: string, summary: string, flow: string },
  plannedLogic: { title: string, summary: string, flow: string }
) => {
  const prompt = `기획된 비즈니스 로직(Planned Logic)과 실제 구현된 비즈니스 로직(Implemented Logic) 간의 충돌(Conflict) 여부를 판단하세요.

[기획된 비즈니스 로직 (Logic B)]
제목: ${plannedLogic.title}
요약: ${plannedLogic.summary}
흐름: ${plannedLogic.flow || '없음'}

[실제 구현된 비즈니스 로직 (Logic A)]
제목: ${implementedLogic.title}
요약: ${implementedLogic.summary}
흐름: ${implementedLogic.flow || '없음'}

판단 규칙:
1. 실제 구현된 로직이 기획된 로직의 핵심 의도와 정면으로 모순되거나, 필수적인 비즈니스 흐름이 누락/변질되었다면 'hasConflict'를 true로 반환하세요.
2. 단순히 기술적 상세함의 차이나, 기획을 해치지 않는 선에서의 추가 구현이라면 false를 반환하세요.
3. 사용자는 비전공자입니다. 차이점을 설명할 때 반드시 일상적인 언어로 풀어서 설명하고, 관련된 전문 용어는 괄호 안에 병기하세요. 또한 이 차이가 앱에 어떤 영향을 미치는지(Impact)도 간단히 설명하세요.
4. [매우 중요] 'design'과 'code' 필드에는 절대 전체 코드나 긴 흐름을 복사하지 마세요. 오직 차이가 발생하는 핵심 부분만 1~2문장으로 아주 짧게 요약해서 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "hasConflict": true 또는 false,
  "summary": "충돌에 대한 비전공자 친화적인 전체 요약 (hasConflict가 true일 때만 포함)",
  "differences": [
    {
      "aspect": "차이가 발생한 부분 (예: 데이터 저장 위치)",
      "design": "기획된 내용 (예: 사용자의 기기에만 임시로 저장하기로 기획됨 (Local Storage))",
      "code": "실제 구현된 내용 (예: 클라우드 서버에 영구적으로 저장하도록 구현됨 (Firestore))",
      "impact": "이 차이가 앱과 사용자에게 미치는 영향"
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hasConflict: { type: Type.BOOLEAN },
          summary: { type: Type.STRING },
          differences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                aspect: { type: Type.STRING },
                design: { type: Type.STRING },
                code: { type: Type.STRING },
                impact: { type: Type.STRING }
              },
              required: ["aspect", "design", "code", "impact"]
            }
          }
        },
        required: ["hasConflict"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" });

  try {
    const result = JSON.parse(response.text || "{}");
    return {
      isConflict: result.hasConflict || false,
      conflictDetails: result.hasConflict ? {
        summary: result.summary || "",
        differences: result.differences || []
      } : undefined
    };
  } catch (e) {
    console.error("Failed to check conflict", e);
    return { isConflict: false };
  }
};

export const getEmbeddingsBulk = async (texts: string[]): Promise<number[][]> => {
  if (!texts || texts.length === 0) return [];
  try {
    const promises = texts.map(text => 
      withTimeout(
        ai.models.embedContent({
          model: 'gemini-embedding-2-preview',
          contents: text
        }),
        30000,
        { embeddings: [{ values: [] }] } as any
      )
    );
    const results = await Promise.all(promises);
    return results.map(res => res.embeddings?.[0]?.values || []);
  } catch (e) {
    console.error("Bulk embedding failed", e);
    return texts.map(() => []);
  }
};

export const cosineSimilarity = (a: number[], b: number[]) => {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const mapLogicsToModulesBulk = async (
  logicsWithCandidates: { 
    index: number, 
    title: string, 
    summary: string, 
    candidateModules: { id: string, title: string, summary: string }[] 
  }[]
) => {
  const prompt = `당신은 여러 개의 비즈니스 로직을 적절한 상위 모듈(Module)로 일괄 그룹화하는 시스템입니다.

[분류할 비즈니스 로직 및 후보 모듈 목록]
${JSON.stringify(logicsWithCandidates, null, 2)}

판단 규칙:
1. 각 로직(index)별로 제공된 'candidateModules' 중 가장 적절한 기존 Module이 있다면 해당 ID를 'mappedModuleId'로 지정하세요.
2. 적절한 Module이 없다면 'mappedModuleId'를 null로 하고, 새로운 상위 Module을 제안하세요 ('suggestedTitle', 'suggestedSummary').
3. 여러 로직이 동일한 새로운 모듈에 속해야 한다면, 동일한 'suggestedTitle'을 사용하여 하나로 묶일 수 있게 하세요.

[새로운 모듈 제안 시 엄격한 제약 조건]
- suggestedTitle: 반드시 20자 이내의 명사형으로만 작성하세요. (예: "노트 데이터 동기화 시스템") 서술어, 부연 설명, 특수문자 절대 금지.
- suggestedSummary: 1~2문장으로 간결하게 핵심 역할만 작성.

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  {
    "index": 0,
    "mappedModuleId": "일치하는 ID 또는 null",
    "suggestedTitle": "새로운 모듈 제목 (null일 때)",
    "suggestedSummary": "새로운 모듈 요약 (null일 때)"
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.INTEGER },
            mappedModuleId: { type: Type.STRING, nullable: true },
            suggestedTitle: { type: Type.STRING, nullable: true },
            suggestedSummary: { type: Type.STRING, nullable: true }
          },
          required: ["index"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" });

  try {
    const result = JSON.parse(response.text || "[]");
    return Array.isArray(result) ? result : [];
  } catch (e) {
    console.error("Failed to bulk map modules", e);
    return [];
  }
};

export const generateFixGuide = async (note: Note, fileContent: string) => {
  const prompt = `기존 설계 문서(Logic Note)와 실제 구현된 코드(Github File) 사이에 충돌(Conflict)이 발생했습니다.
개발자는 "설계가 맞습니다"라고 판단했습니다. 즉, 현재 코드가 기존 설계 의도와 다르게 잘못 구현되었거나 누락된 부분이 있습니다.

아래의 [기존 설계 문서]와 [현재 코드]를 비교 분석하여, 코드를 어떻게 수정해야 설계에 부합하게 되는지 **구현 보정 가이드(가이드라인)**를 마크다운 형식으로 작성해 주세요.

[기존 설계 문서]
제목: ${note.title}
요약: ${note.summary}
비즈니스 규칙: ${note.businessRules || '없음'}
제약 사항: ${note.constraints || '없음'}
입출력 매핑: ${note.ioMapping || '없음'}
예외 상황: ${note.edgeCases || '없음'}

[현재 코드]
\`\`\`
${fileContent}
\`\`\`

가이드라인 작성 규칙:
1. [대상 독자] 사용자는 코딩을 모르는 비전공자(기획자)입니다. 따라서 **절대 구체적인 코드(코드 스니펫, 변수명, 함수명 등)를 제시하지 마세요.**
2. [작성 방식] 코드를 어떻게 수정해야 하는지, 프로그램이 작동해야 하는 **'논리적 흐름'**을 순서대로(1, 2, 3...) 풀어서 설명하세요.
3. [출력 예시] 반드시 아래와 같은 문체와 구조로 작성하세요.
   - 1. 사용자가 현재 선택한 프로젝트가 올바른지 확인하며, 선택된 프로젝트가 없다면 빈 화면을 유지합니다.
   - 2. 저장되어 있는 모든 메모 정보를 데이터베이스에서 불러옵니다.
   - 3. 불러온 전체 메모 중 현재 선택한 프로젝트와 연결된 메모만 골라냅니다.
   - 4. 최종적으로 정리된 메모 리스트를 사용자 화면에 반영하여 보여줍니다.
`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const response = await withTimeout(responsePromise, 45000, { text: "가이드를 생성하지 못했습니다." } as any);

  return response.text || "가이드를 생성하지 못했습니다.";
};

export const chatWithArchitect = async (
  messages: { role: 'user' | 'assistant', content: string }[],
  blueprintSummary: string
) => {
  const prompt = `당신은 전체 프로젝트의 아키텍처를 설계하고 관리하는 전문 AI 아키텍트입니다.
제공된 [프로젝트 설계도 요약]을 바탕으로 사용자의 질문에 답변하세요.

[프로젝트 설계도 요약]
${blueprintSummary}

[대화 기록]
${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

답변 규칙:
1. 설계도에 기반하여 구체적이고 기술적인 답변을 제공하세요.
2. 설계도에 없는 내용은 추측하지 말고, 설계도에 없음을 명시하세요.
3. 비전공자도 이해할 수 있도록 전문 용어는 쉽게 풀어서 설명하세요.
4. 답변은 간결하고 명확하게 작성하세요.
`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const response = await withTimeout(responsePromise, 60000, { text: "답변을 생성하지 못했습니다." } as any);

  return response.text || "답변을 생성하지 못했습니다.";
};

export const generateProactiveNudgesWithKeywords = async (
  notes: Note[], 
  pastNudges: string[] = [], 
  track: 'Involution' | 'Evolution', 
  keywords: string[]
) => {
  let typeInstruction = '';
  let typeDefinitions = '';
  let allowedTypes = '';

  if (track === 'Involution') {
    typeInstruction = `반드시 4가지 타입(Cost, Debt, EdgeCase, Efficiency) 각각에 대해 1개씩, 총 4개의 내적 최적화(Involution) 제안을 생성하세요.`;
    typeDefinitions = `[4가지 Nudge 타입 정의 (Track: Involution - 내적 최적화)]
1. Cost (비용 최적화): "Firebase 읽기/쓰기 비용을 줄이기 위해 [A 로직]에 캐싱 계층을 도입하는 것은 어떨까요?"
2. Debt (기술 부채 해결): "현재 [B 모듈]의 구조가 확장성에 제약이 될 수 있습니다. [C 패턴]으로 리팩토링할까요?"
3. EdgeCase (예외/오류 처리): "유저가 [D 상황]에 처했을 때의 예외 처리가 누락되어 있습니다. 이를 보완할까요?"
4. Efficiency (알고리즘/성능 효율화): "[E 기능]의 처리 속도를 높이기 위해 [F 최적화 기법]을 적용해볼 수 있습니다."`;
    allowedTypes = `"Cost" | "Debt" | "EdgeCase" | "Efficiency"`;
  } else {
    typeInstruction = `반드시 4가지 타입(AhaMoment, HighImpact, Pivot, Expansion) 각각에 대해 1개씩, 총 4개의 외적 성장(Evolution) 제안을 생성하세요.`;
    typeDefinitions = `[4가지 Nudge 타입 정의 (Track: Evolution - 외적 임팩트)]
토스의 철학("임팩트 없는 디테일은 낭비다")을 반영하여, 사소한 UI 개선이 아닌 제품의 성패를 가를 거대한 변화를 제안하세요.
1. AhaMoment (아하 모먼트): "유저가 이 서비스를 반드시 써야만 하는 결정적 순간을 만들기 위해 [A 기능]을 도입합시다."
2. HighImpact (핵심 지표 10배 성장): "사소한 개선 대신, 지표를 폭발적으로 성장시킬 수 있는 [B 비즈니스 모델/기능]을 추가하는 것은 어떨까요?"
3. Pivot (관점의 전환): "현재 [C 타겟]에 머물러 있는데, 이를 [D 시장]으로 확장하여 완전히 새로운 가치를 창출해봅시다."
4. Expansion (생태계 확장): "단순한 유틸리티를 넘어, 유저들이 상호작용하는 [E 커뮤니티/플랫폼]으로 진화시켜야 합니다."`;
    allowedTypes = `"AhaMoment" | "HighImpact" | "Pivot" | "Expansion"`;
  }

  const keywordInstruction = keywords.length > 0
    ? `\n[사용자 지정 키워드: ${keywords.join(', ')}]\n이 키워드들과 관련된 인사이트를 우선적으로 생성하세요.`
    : '';

  const blacklistInstruction = pastNudges.length > 0
    ? `\n[주의: 다음 아이디어들은 이미 사용자가 거절했거나 검토한 내용이므로 **절대 중복해서 제안하지 마세요**]\n${pastNudges.map(n => `- ${n}`).join('\n')}\n`
    : '';

  const systemContext = notes.map(n => {
    let text = `[${n.noteType}] ${n.title} (Status: ${n.status})`;
    if (n.summary) text += `\n  Summary: ${n.summary}`;
    if (n.noteType === 'Domain') {
      if (n.vision) text += `\n  Vision: ${n.vision}`;
      if (n.boundaries) text += `\n  Boundaries: ${n.boundaries}`;
    } else if (n.noteType === 'Module') {
      if (n.uxGoals) text += `\n  UX Goals: ${n.uxGoals}`;
      if (n.requirements) text += `\n  Requirements: ${n.requirements}`;
    } else if (n.noteType === 'Logic') {
      if (n.businessRules) text += `\n  Business Rules: ${n.businessRules}`;
      if (n.constraints) text += `\n  Constraints: ${n.constraints}`;
    } else if (n.noteType === 'Snapshot') {
      if (n.technicalRole) text += `\n  Technical Role: ${n.technicalRole}`;
      if (n.executionFlow) text += `\n  Execution Flow: ${n.executionFlow}`;
    }
    return text;
  }).join('\n\n');

  const prompt = `당신은 비전공자 창업자를 돕는 세계 최고의 비즈니스 파트너이자 AI 코파운더입니다.
단순히 기술적인 조언을 하는 것이 아니라, 사용자의 프로젝트를 깊이 있게 분석하여 누구나 이해할 수 있는 쉬운 언어로 실질적인 조언을 제공해야 합니다.

${track === 'Involution' ? '현재 서비스가 더 빠르고 안정적으로 돌아가기 위한 내실을 다지는 제안을 하세요.' : '사소한 기능 개선이 아닌, 서비스의 성패를 결정지을 수 있는 거대한 변화와 성장을 위한 제안을 하세요.'}

${typeInstruction}
${keywordInstruction}
${blacklistInstruction}
${typeDefinitions}

[작성 지침 - 매우 중요]
1. 비전공자도 한눈에 이해할 수 있도록 아주 쉬운 일상 언어를 사용하세요.
2. '캐싱', '리팩토링', 'API', '인프라' 같은 기술 용어는 절대 사용하지 마세요. 대신 '정보 임시 저장', '구조 개선', '연결 통로' 등으로 풀어서 설명하세요.
3. 제안의 핵심은 '사용자가 얻는 가치'와 '비즈니스적 이득'이어야 합니다.
4. 가설(hypothesis) 부분은 "이 기능을 추가하면 [A]라는 문제가 해결되고, 결과적으로 [B]라는 이득이 생깁니다"라는 논리 구조로 작성하세요.

[현재 프로젝트 전체 설계 요약]
${systemContext}

반드시 아래 JSON 형식으로만 응답하세요.
{
  "nudges": [
    {
      "id": "고유 ID",
      "nudgeType": ${allowedTypes},
      "track": "${track}",
      "context": "현재 상황에 대한 쉬운 진단 (1문장)",
      "question": "사용자에게 던지는 핵심 질문 (1문장, 예: '결제 과정을 더 단순하게 줄여볼까요?')",
      "hypothesis": "이 제안을 선택했을 때의 기대 효과 (비전공자도 이해할 수 있는 쉬운 설명)",
      "actionPrompt": "이 아이디어를 시스템에 추가하기 위한 구체적인 행동 지침"
    }
  ]
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nudges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                nudgeType: { type: Type.STRING },
                context: { type: Type.STRING },
                question: { type: Type.STRING },
                hypothesis: { type: Type.STRING },
                actionPrompt: { type: Type.STRING }
              },
              required: ["id", "nudgeType", "context", "question", "hypothesis", "actionPrompt"]
            }
          }
        },
        required: ["nudges"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: '{"nudges": []}' } as any);
  
  if (!response || !response.text) {
    console.warn("Gemini returned empty response for nudges, returning empty array.");
    return [];
  }

  try {
    const jsonStr = response.text.trim();
    console.log("JSON String:", jsonStr);
    const parsed = JSON.parse(jsonStr).nudges as any[];
    console.log("Parsed:", parsed);
    if (!parsed) return [];
    return parsed.map(n => ({ ...n, track })) as ProactiveNudge[];
  } catch (e) {
    console.error("Failed to parse Nudges JSON", e);
    return [];
  }
};


export const refineBlueprintDraft = async (draft: any, feedback: string) => {
  const safeDraft = draft || {};
  const prompt = `당신은 비전공자 창업자를 돕는 친절한 기술 파트너입니다.
현재 초안으로 작성된 설계도(Blueprint)가 있습니다. 사용자의 피드백을 반영하여 이 설계도를 수정/보완하세요.

[현재 설계도 초안]
${JSON.stringify(safeDraft, null, 2)}

[사용자 피드백]
${feedback}

[작성 지침]
1. 사용자의 피드백을 정확히 반영하되, 전체적인 비즈니스 설계의 완성도를 높이는 방향으로 수정하세요.
2. **구조의 견고함**: 도메인, 모듈, 로직의 계층 구조가 논리적으로 타당하고 부실하지 않게 구성하세요.
3. 비전공자가 이해하기 쉬운 언어를 사용하세요.
4. **상세 정보 제외**: 이 단계에서는 '제목(title)'과 '요약(summary)'만 생성하세요. 상세한 비즈니스 구성 요소나 흐름은 다음 단계에서 생성될 예정입니다.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "modules": [
        {
          "title": "...",
          "summary": "...",
          "logics": [
            {
              "title": "...",
              "summary": "..."
            }
          ]
        }
      ]
    }
  ]
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: JSON.stringify(safeDraft) } as any);
  try {
    return JSON.parse(response.text || JSON.stringify(safeDraft));
  } catch (e) {
    console.error("Failed to refine blueprint draft", e);
    return safeDraft;
  }
};

export const generateKeywords = async (notes: Note[]) => {
  const prompt = `현재 프로젝트의 설계 요약을 바탕으로, 인사이트를 생성하기 위한 핵심 키워드 5개를 생성하세요.
[설계 요약]
${notes.map(n => n.title).join(', ')}

반드시 아래 JSON 형식으로만 응답하세요:
{
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"]
}
`;
  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  const response = await withTimeout(responsePromise, 30000, { text: '{"keywords": []}' } as any);
  try {
    return JSON.parse(response.text || '{"keywords": []}').keywords;
  } catch (e) {
    return [];
  }
};

export const generateDetailedNodeContent = async (nodeType: string, title: string, summary: string, parentContext: string, siblingContext: string) => {
  const prompt = `당신은 비전공자 창업자를 돕는 친절한 기술 가이드입니다.
다음 항목에 대한 상세 설명과 작동 규칙을 작성해주세요.

제목: ${title}
요약: ${summary}
유형: ${nodeType}

[주변 맥락]
- 상위 영역: ${parentContext || '없음'}
- 함께 있는 다른 기능들: ${siblingContext || '없음'}

[작성 지침 - 매우 중요]
1. 초등학생도 이해할 수 있을 정도로 쉬운 비유와 일상 언어를 사용하세요.
2. 기술적인 구현 방법(코드, DB 구조 등)보다는 '이 기능이 사용자에게 어떤 경험을 주는지'와 '어떤 규칙으로 움직이는지'를 중심으로 설명하세요.
3. '모듈', '컴포넌트', '엔드포인트', '인스턴스' 같은 단어는 절대 사용하지 마세요.
4. 마크다운 형식을 사용하여 읽기 좋게 구성하세요. 가독성을 위해 각 항목은 마크다운 리스트(- )를 사용하고, 문단 사이에 반드시 빈 줄(\\n\\n)을 넣어주세요.
5. 다른 기능들과 역할이 겹치지 않도록 이 기능만의 고유한 역할을 설명하세요.
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
  });

  const response = await withTimeout(responsePromise, 60000, { text: `${summary}\n\n(상세 내용 생성 실패)` } as any);
  
  // Domain이나 Module의 경우 이미 구조화된 필드가 많으므로 body는 최소화하거나 요약만 반환
  if (nodeType === 'Domain' || nodeType === 'Module') {
    return summary;
  }
  
  return response.text || summary;
};
export const generateDetailedBusinessDetails = async (nodeType: string, title: string, summary: string, parentContext: string, siblingContext: string) => {
  let prompt = '';
  let properties: any = {};
  let required: string[] = [];

  if (nodeType.includes('Domain')) {
    prompt = `당신은 비즈니스 전략 전문가입니다. 다음 '주요 영역(Domain)'에 대한 전략적 상세 정보를 작성하세요.
제목: ${title}
요약: ${summary}
[주변 맥락]
- 함께 있는 다른 영역들: ${siblingContext || '없음'}

[작성 지침]
1. 비전공자 창업자도 이해할 수 있는 비즈니스 언어를 사용하세요.
2. 가독성을 위해 boundaries, kpis, glossary 필드의 내용은 마크다운 리스트(- )를 적극 활용하고, 문단 사이에 반드시 빈 줄(\\n\\n)을 넣어주세요.
3. **중요: painPoint, targetAudience, solutionPromise 필드는 리스트(- )를 사용하지 마세요.** 반드시 핵심을 관통하는 **단 하나의 명확하고 간결한 문장**으로만 작성하세요.
4. 다음 6가지 항목을 반드시 포함하여 JSON으로 응답하세요:
   - painPoint (사용자 고통): 이 영역에서 사용자가 겪는 구체적인 고통 (단일 문장).
   - targetAudience (타겟 고객): 이 영역의 기능을 통해 혜택을 받는 핵심 타겟 (단일 문장).
   - solutionPromise (해결 가설): 이 영역이 제공하는 마법 같은 해결책과 가치 (단일 문장).
   - boundaries (책임 범위): 담당하는 핵심 데이터와 프로세스, 그리고 하지 않는 일(Out of Scope) 명시 (리스트 형식).
   - kpis (성공 지표): 이 영역이 제 역할을 하고 있는지 판단하는 객관적 기준 (리스트 형식).
   - glossary (핵심 용어집): 도메인 내 소통의 오해를 없애기 위한 핵심 용어 및 비즈니스 개념 정의 (리스트 형식).
`;
    properties = {
      painPoint: { type: Type.STRING },
      targetAudience: { type: Type.STRING },
      solutionPromise: { type: Type.STRING },
      boundaries: { type: Type.STRING },
      kpis: { type: Type.STRING },
      glossary: { type: Type.STRING }
    };
    required = ["painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary"];
  } else if (nodeType.includes('Module')) {
    prompt = `당신은 UX/서비스 기획 전문가입니다. 다음 '세부 기능(Module)'에 대한 기획 상세 정보를 작성하세요.
제목: ${title}
요약: ${summary}
[주변 맥락]
- 상위 영역: ${parentContext}
- 함께 있는 다른 기능들: ${siblingContext || '없음'}

[작성 지침]
1. 사용자 경험(UX) 관점에서 작성하세요.
2. 가독성을 위해 requirements, userJourney, ia 필드의 내용은 마크다운 리스트(- )를 적극 활용하고, 문단 사이에 반드시 빈 줄(\\n\\n)을 넣어주세요.
3. **중요: painPoint, targetAudience, solutionPromise 필드는 리스트(- )를 사용하지 마세요.** 반드시 핵심을 관통하는 **단 하나의 명확하고 간결한 문장**으로만 작성하세요.
4. 다음 6가지 항목을 반드시 포함하여 JSON으로 응답하세요:
   - painPoint (사용자 고통): 이 기능을 통해 해결하려는 사용자의 구체적인 불편함 (단일 문장).
   - targetAudience (타겟 사용자): 이 기능을 주로 사용하게 될 핵심 사용자 층 (단일 문장).
   - solutionPromise (해결책의 약속): 이 기능이 사용자에게 주는 핵심 가치와 마법 같은 해결책 (단일 문장).
   - requirements (기능적 요구사항): 반드시 수행해야 하는 기능 리스트 (리스트 형식).
   - userJourney (사용자 여정): 사용자가 기능을 사용하는 시나리오와 단계별 흐름 (리스트 형식).
   - ia (정보 구조): 이 기능에서 다루는 주요 데이터 객체들의 관계 (리스트 형식).
`;
    properties = {
      painPoint: { type: Type.STRING },
      targetAudience: { type: Type.STRING },
      solutionPromise: { type: Type.STRING },
      requirements: { type: Type.STRING },
      userJourney: { type: Type.STRING },
      ia: { type: Type.STRING }
    };
    required = ["painPoint", "targetAudience", "solutionPromise", "requirements", "userJourney", "ia"];
  } else { // Logic
    prompt = `당신은 비즈니스 프로세스 설계 전문가입니다. 다음 '핵심 규칙(Logic)'에 대한 상세 로직 정보를 작성하세요.
제목: ${title}
요약: ${summary}
[주변 맥락]
- 상위 영역 및 기능: ${parentContext}
- 함께 있는 다른 규칙들: ${siblingContext || '없음'}

[작성 지침]
1. 논리적이고 구체적으로 작성하세요.
2. 가독성을 위해 businessRules, constraints, ioMapping, edgeCases 필드의 내용은 마크다운 리스트(- )를 적극 활용하고, 문단 사이에 반드시 빈 줄(\\n\\n)을 넣어주세요.
3. **중요: painPoint, targetAudience, solutionPromise 필드는 리스트(- )를 사용하지 마세요.** 반드시 핵심을 관통하는 **단 하나의 명확하고 간결한 문장**으로만 작성하세요.
4. 다음 7가지 항목을 반드시 포함하여 JSON으로 응답하세요:
   - painPoint (해결하려는 문제점): 이 로직이 해결하는 구체적인 문제나 비효율 (단일 문장).
   - targetAudience (핵심 타겟): 이 로직의 결과를 직접적으로 체감하는 대상 (단일 문장).
   - solutionPromise (제공 가치): 이 로직이 정상 작동했을 때 얻는 핵심 가치 (단일 문장).
   - businessRules (의사결정 규칙): '만약 ~라면 ~한다' 식의 구체적인 판단 로직 (리스트 형식).
   - constraints (제약 조건): 데이터의 유효성, 보안 규칙, 정책적 한계 (리스트 형식).
   - ioMapping (데이터 입출력 매핑): 입력값이 어떤 과정을 거쳐 어떤 결과값으로 변하는지 정의 (리스트 형식).
   - edgeCases (예외 처리): 비정상적인 상황이나 오류 발생 시의 대응 규칙 (리스트 형식).
`;
    properties = {
      painPoint: { type: Type.STRING },
      targetAudience: { type: Type.STRING },
      solutionPromise: { type: Type.STRING },
      businessRules: { type: Type.STRING },
      constraints: { type: Type.STRING },
      ioMapping: { type: Type.STRING },
      edgeCases: { type: Type.STRING }
    };
    required = ["painPoint", "targetAudience", "solutionPromise", "businessRules", "constraints", "ioMapping", "edgeCases"];
  }

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties,
        required
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: "{}" } as any);
  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    return {};
  }
};

import pLimit from 'p-limit';

// ... (existing code)

export const generateDetailedBlueprint = async (blueprint: any, onProgress?: (msg: string) => void) => {
  const limit = pLimit(1); // Limit concurrency to 1 to completely avoid rate limits
  let completedCount = 0;
  const totalNodes = blueprint.domains.reduce((acc: number, d: any) => 
    acc + 1 + (d.modules?.length || 0) + (d.modules?.reduce((mAcc: number, m: any) => mAcc + (m.logics?.length || 0), 0) || 0), 0);

  const updateProgress = (nodeTitle: string) => {
    completedCount++;
    if (onProgress) onProgress(`상세화 진행 중: ${Math.round((completedCount / totalNodes) * 100)}% (${nodeTitle})`);
  };

  const detailedDomains = await Promise.all(blueprint.domains.map((domain: any) => limit(async () => {
    const domainSiblingContext = blueprint.domains.filter((d: any) => d.title !== domain.title).map((d: any) => `- ${d.title}: ${d.summary}`).join('\n');
    
    const domainContent = await generateDetailedNodeContent('Domain', domain.title, domain.summary, '전체 시스템 아키텍처', domainSiblingContext);
    const domainDetails = await generateDetailedBusinessDetails('Domain', domain.title, domain.summary, '전체 시스템 아키텍처', domainSiblingContext);
    
    updateProgress(domain.title);

    const detailedModules = domain.modules ? await Promise.all(domain.modules.map((mod: any) => limit(async () => {
      const modParentContext = `상위 도메인: ${domain.title} (${domain.summary})`;
      const modSiblingContext = domain.modules.filter((m: any) => m.title !== mod.title).map((m: any) => `- ${m.title}: ${m.summary}`).join('\n');
      
      const modContent = await generateDetailedNodeContent('Module', mod.title, mod.summary, modParentContext, modSiblingContext);
      const modDetails = await generateDetailedBusinessDetails('Module', mod.title, mod.summary, modParentContext, modSiblingContext);
      
      updateProgress(mod.title);

      const detailedLogics = mod.logics ? await Promise.all(mod.logics.map((logic: any) => limit(async () => {
        const logicParentContext = `상위 도메인: ${domain.title}\n상위 모듈: ${mod.title} (${mod.summary})`;
        const logicSiblingContext = mod.logics.filter((l: any) => l.title !== logic.title).map((l: any) => `- ${l.title}: ${l.summary}`).join('\n');
        
        const logicContent = await generateDetailedNodeContent('Logic', logic.title, logic.summary, logicParentContext, logicSiblingContext);
        const logicDetails = await generateDetailedBusinessDetails('Logic', logic.title, logic.summary, logicParentContext, logicSiblingContext);
        
        updateProgress(logic.title);

        return { 
          ...logic, 
          content: logicContent,
          painPoint: logicDetails.painPoint,
          targetAudience: logicDetails.targetAudience,
          solutionPromise: logicDetails.solutionPromise,
          businessRules: logicDetails.businessRules,
          constraints: logicDetails.constraints,
          ioMapping: logicDetails.ioMapping,
          edgeCases: logicDetails.edgeCases
        };
      }))) : [];

      return { 
        ...mod, 
        content: modContent, 
        painPoint: modDetails.painPoint,
        targetAudience: modDetails.targetAudience,
        solutionPromise: modDetails.solutionPromise,
        requirements: modDetails.requirements,
        userJourney: modDetails.userJourney,
        ia: modDetails.ia,
        logics: detailedLogics 
      };
    }))) : [];

    return { 
      ...domain, 
      content: domainContent, 
      vision: domainDetails.vision,
      boundaries: domainDetails.boundaries,
      stakeholders: domainDetails.stakeholders,
      kpis: domainDetails.kpis,
      glossary: domainDetails.glossary,
      modules: detailedModules 
    };
  })));

  return { domains: detailedDomains };
};

export const generateModuleFromCluster = async (logics: {title: string, summary: string, businessRules?: string, constraints?: string, ioMapping?: string, edgeCases?: string}[]) => {
  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트이자 비즈니스 전략가입니다.
다음은 수학적 유사도를 기반으로 군집화된 로직(Logic)들의 목록입니다. 이 로직들을 포괄하는 하나의 모듈(Module)을 설계하세요.

[포함된 로직 목록]
${JSON.stringify(logics, null, 2)}

[요구사항]
1. 모듈의 이름(title)과 한 줄 요약(summary)을 **한국어**로 작성하세요.
2. **중요**: 제목(title)은 개발자가 아닌 일반 사용자나 기획자도 한눈에 이해할 수 있을 만큼 **매우 직관적이고 쉬운 단어**를 사용하세요.
3. 하위 로직들의 정보를 종합하여 다음 7가지 항목을 작성하세요:
   - painPoint (사용자 고통): 이 모듈이 해결하려는 핵심적인 사용자 불편함. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
   - targetAudience (타겟 사용자): 이 모듈의 주요 사용자 층. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
   - solutionPromise (해결 가설): 이 모듈이 제공하는 핵심 가치 제안. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
   - uxGoals (사용자 목표): 사용자가 이 모듈을 통해 달성하고자 하는 핵심 목표.
   - requirements (기능적 요구사항): 모듈이 반드시 수행해야 하는 기능 리스트.
   - userJourney (사용자 여정): 사용자가 기능을 사용하는 시나리오나 단계.
   - ia (정보 구조): 주요 데이터 객체들의 관계나 구조.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "...",
  "summary": "...",
  "painPoint": "...",
  "targetAudience": "...",
  "solutionPromise": "...",
  "uxGoals": "...",
  "requirements": "...",
  "userJourney": "...",
  "ia": "..."
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          painPoint: { type: Type.STRING },
          targetAudience: { type: Type.STRING },
          solutionPromise: { type: Type.STRING },
          uxGoals: { type: Type.STRING },
          requirements: { type: Type.STRING },
          userJourney: { type: Type.STRING },
          ia: { type: Type.STRING }
        },
        required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "uxGoals", "requirements", "userJourney", "ia"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);
  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to generate module from cluster", e);
    return { title: "Unknown Module", summary: "Failed to generate", uxGoals: "", requirements: "", userJourney: "", ia: "" };
  }
};

export const generateDomainsFromModules = async (modules: {id: string, title: string, summary: string, uxGoals?: string, requirements?: string, userJourney?: string, ia?: string}[]) => {
  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트이자 비즈니스 전략가입니다.
다음은 시스템을 구성하는 모듈(Module)들의 목록입니다. 이 모듈들을 분석하여 3~5개의 최상위 도메인(Domain)으로 분류하고 설계하세요.

[모듈 목록]
${JSON.stringify(modules, null, 2)}

[요구사항]
1. 각 도메인의 이름(title), 요약(summary)을 **한국어**로 작성하세요.
2. **중요**: 도메인 제목(title)은 시스템의 거대한 뼈대를 나타내므로 매우 직관적이고 명확한 한국어 단어를 사용하세요.
3. 다음 6가지 항목을 마크다운 형식으로 작성하세요:
   - painPoint (사용자 고통): 이 도메인이 해결하려는 핵심적인 사용자 불편함. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
   - targetAudience (타겟 사용자): 이 도메인의 주요 사용자 층. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
   - solutionPromise (해결 가설): 이 도메인이 제공하는 핵심 가치 제안. **반드시 리스트(- )를 사용하지 말고, 핵심을 관통하는 단 하나의 간결한 문장으로만 작성하세요.**
   - boundaries (서비스 경계): 포함되는 기능과 포함되지 않는 기능의 명확한 구분.
   - kpis (성공 지표): 비즈니스 성공을 판단할 수 있는 지표.
   - glossary (핵심 용어집): 도메인 내 소통의 오해를 없애기 위한 핵심 용어 및 비즈니스 개념 정의.
4. 각 도메인에 속하는 모듈들의 ID(moduleIds)를 배열로 매핑하세요. 모든 모듈은 반드시 하나의 도메인에 속해야 합니다.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "painPoint": "...",
      "targetAudience": "...",
      "solutionPromise": "...",
      "boundaries": "...",
      "kpis": "...",
      "glossary": "...",
      "moduleIds": ["모듈 ID 1", "모듈 ID 2"]
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          domains: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                painPoint: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                solutionPromise: { type: Type.STRING },
                boundaries: { type: Type.STRING },
                kpis: { type: Type.STRING },
                glossary: { type: Type.STRING },
                moduleIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary", "moduleIds"]
            }
          }
        },
        required: ["domains"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: "{}" } as any);
  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to generate domains from modules", e);
    return { domains: [] };
  }
};

// Phase 9: Proactive AI Co-founder (Continuous Ideation)
export const refineIdeaWithSparring = async (notes: Note[], nudge: ProactiveNudge, userResponse: string) => {
  const prompt = `당신은 비전공자 창업자를 돕는 친절한 기술 파트너입니다.
사용자가 당신의 제안(Nudge)에 대해 피드백을 주었습니다. 사용자의 응답을 바탕으로, 실제 시스템에 추가할 수 있는 구체적인 설계도(Blueprint)를 작성하세요.

[AI의 초기 제안 및 가설]
- 타입: ${nudge.nudgeType}
- 질문: ${nudge.question}
- 가설: ${nudge.hypothesis}

[사용자의 피드백]
"${userResponse}"

[현재 프로젝트 상태]
${notes.map(n => `- ${n.title} (${n.noteType})`).join('\n')}

[작성 지침 - 매우 중요]
1. 비전공자도 이해할 수 있도록 아주 쉬운 일상 언어를 사용하세요.
2. 기술 용어 대신 기능의 목적과 사용자 가치를 중심으로 설명하세요.
3. 제목과 요약은 직관적이어야 하며, 사용자의 의도를 완벽하게 반영해야 합니다.
4. 구조는 반드시 Domain -> Module -> Logic 계층 구조여야 합니다.
5. 각 레벨별로 다음 필드를 반드시 포함하세요:
   - Domain: title, summary, vision, boundaries, stakeholders, kpis, glossary
   - Module: title, summary, uxGoals, requirements
   - Logic: title, summary, businessRules, constraints, ioMapping, edgeCases

반드시 아래 JSON 형식으로만 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "vision": "...",
      "boundaries": "...",
      "stakeholders": "...",
      "kpis": "...",
      "glossary": "...",
      "modules": [
        {
          "title": "...",
          "summary": "...",
          "uxGoals": "...",
          "requirements": "...",
          "logics": [
            {
              "title": "...",
              "summary": "...",
              "businessRules": "...",
              "constraints": "...",
              "ioMapping": "...",
              "edgeCases": "..."
            }
          ]
        }
      ]
    }
  ]
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          domains: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                vision: { type: Type.STRING },
                boundaries: { type: Type.STRING },
                modules: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      uxGoals: { type: Type.STRING },
                      requirements: { type: Type.STRING },
                      logics: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            businessRules: { type: Type.STRING },
                            constraints: { type: Type.STRING },
                            ioMapping: { type: Type.STRING },
                            edgeCases: { type: Type.STRING }
                          },
                          required: ["title", "summary", "businessRules", "constraints", "ioMapping", "edgeCases"]
                        }
                      }
                    },
                    required: ["title", "summary", "uxGoals", "requirements", "logics"]
                  }
                }
              },
              required: ["title", "summary", "vision", "boundaries", "modules"]
            }
          }
        },
        required: ["domains"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: "[]" } as any);
  if (!response || !response.text) {
    throw new Error("Failed to refine idea with sparring.");
  }

  try {
    const jsonStr = response.text.trim();
    return JSON.parse(jsonStr) as {
      domains: {
        title: string;
        summary: string;
        vision: string;
        boundaries: string;
        modules: {
          title: string;
          summary: string;
          uxGoals: string;
          requirements: string;
          logics: { 
            title: string; 
            summary: string; 
            businessRules: string;
            constraints: string;
            ioMapping: string;
            edgeCases: string;
          }[];
        }[];
      }[];
    };
  } catch (e) {
    console.error("Failed to parse Feature Blueprint JSON", e);
    throw new Error("Invalid JSON format from AI.");
  }
};
export const generateProactiveNudges = async (notes: Note[], pastNudges: string[] = [], track: 'Involution' | 'Evolution', targetType?: string) => {
  let typeInstruction = '';
  let typeDefinitions = '';
  let allowedTypes = '';

  if (track === 'Involution') {
    typeInstruction = targetType 
      ? `반드시 '${targetType}' 타입의 내적 최적화 제안 1개를 생성하세요.`
      : `반드시 4가지 타입(Cost, Debt, EdgeCase, Efficiency) 각각에 대해 1개씩, 총 4개의 내적 최적화(Involution) 제안을 생성하세요.`;
    
    typeDefinitions = `[4가지 Nudge 타입 정의 (Track: Involution - 내적 최적화)]
1. Cost (비용 최적화): "Firebase 읽기/쓰기 비용을 줄이기 위해 [A 로직]에 캐싱 계층을 도입하는 것은 어떨까요?"
2. Debt (기술 부채 해결): "현재 [B 모듈]의 구조가 확장성에 제약이 될 수 있습니다. [C 패턴]으로 리팩토링할까요?"
3. EdgeCase (예외/오류 처리): "유저가 [D 상황]에 처했을 때의 예외 처리가 누락되어 있습니다. 이를 보완할까요?"
4. Efficiency (알고리즘/성능 효율화): "[E 기능]의 처리 속도를 높이기 위해 [F 최적화 기법]을 적용해볼 수 있습니다."`;
    
    allowedTypes = `"Cost" | "Debt" | "EdgeCase" | "Efficiency"`;
  } else {
    typeInstruction = targetType 
      ? `반드시 '${targetType}' 타입의 거대한 임팩트 제안 1개를 생성하세요.`
      : `반드시 4가지 타입(AhaMoment, HighImpact, Pivot, Expansion) 각각에 대해 1개씩, 총 4개의 외적 성장(Evolution) 제안을 생성하세요.`;
    
    typeDefinitions = `[4가지 Nudge 타입 정의 (Track: Evolution - 외적 임팩트)]
토스의 철학("임팩트 없는 디테일은 낭비다")을 반영하여, 사소한 UI 개선이 아닌 제품의 성패를 가를 거대한 변화를 제안하세요.
1. AhaMoment (아하 모먼트): "유저가 이 서비스를 반드시 써야만 하는 결정적 순간을 만들기 위해 [A 기능]을 도입합시다."
2. HighImpact (핵심 지표 10배 성장): "사소한 개선 대신, 지표를 폭발적으로 성장시킬 수 있는 [B 비즈니스 모델/기능]을 추가하는 것은 어떨까요?"
3. Pivot (관점의 전환): "현재 [C 타겟]에 머물러 있는데, 이를 [D 시장]으로 확장하여 완전히 새로운 가치를 창출해봅시다."
4. Expansion (생태계 확장): "단순한 유틸리티를 넘어, 유저들이 상호작용하는 [E 커뮤니티/플랫폼]으로 진화시켜야 합니다."`;
    
    allowedTypes = `"AhaMoment" | "HighImpact" | "Pivot" | "Expansion"`;
  }

  const blacklistInstruction = pastNudges.length > 0
    ? `\n[주의: 다음 아이디어들은 이미 사용자가 거절했거나 검토한 내용이므로 **절대 중복해서 제안하지 마세요**]\n${pastNudges.map(n => `- ${n}`).join('\n')}\n`
    : '';

  const systemContext = notes.map(n => {
    let text = `[${n.noteType}] ${n.title} (Status: ${n.status})`;
    if (n.summary) text += `\n  Summary: ${n.summary}`;
    if (n.noteType === 'Domain') {
      if (n.vision) text += `\n  Vision: ${n.vision}`;
      if (n.boundaries) text += `\n  Boundaries: ${n.boundaries}`;
    } else if (n.noteType === 'Module') {
      if (n.uxGoals) text += `\n  UX Goals: ${n.uxGoals}`;
      if (n.requirements) text += `\n  Requirements: ${n.requirements}`;
    } else if (n.noteType === 'Logic') {
      if (n.businessRules) text += `\n  Business Rules: ${n.businessRules}`;
      if (n.constraints) text += `\n  Constraints: ${n.constraints}`;
    } else if (n.noteType === 'Snapshot') {
      if (n.technicalRole) text += `\n  Technical Role: ${n.technicalRole}`;
      if (n.executionFlow) text += `\n  Execution Flow: ${n.executionFlow}`;
    }
    return text;
  }).join('\n\n');

  const prompt = `당신은 비전공자 창업자를 돕는 세계 최고의 비즈니스 파트너이자 AI 코파운더입니다.
단순히 기술적인 조언을 하는 것이 아니라, 사용자의 프로젝트를 깊이 있게 분석하여 누구나 이해할 수 있는 쉬운 언어로 실질적인 조언을 제공해야 합니다.

${track === 'Involution' ? '현재 서비스가 더 빠르고 안정적으로 돌아가기 위한 내실을 다지는 제안을 하세요.' : '사소한 기능 개선이 아닌, 서비스의 성패를 결정지을 수 있는 거대한 변화와 성장을 위한 제안을 하세요.'}

${typeInstruction}
${blacklistInstruction}
${typeDefinitions}

[작성 지침 - 매우 중요]
1. 비전공자도 한눈에 이해할 수 있도록 아주 쉬운 일상 언어를 사용하세요.
2. '캐싱', '리팩토링', 'API', '인프라' 같은 기술 용어는 절대 사용하지 마세요. 대신 '정보 임시 저장', '구조 개선', '연결 통로' 등으로 풀어서 설명하세요.
3. 제안의 핵심은 '사용자가 얻는 가치'와 '비즈니스적 이득'이어야 합니다.
4. 가설(hypothesis) 부분은 "이 기능을 추가하면 [A]라는 문제가 해결되고, 결과적으로 [B]라는 이득이 생깁니다"라는 논리 구조로 작성하세요.

[현재 프로젝트 전체 설계 요약]
${systemContext}

반드시 아래 JSON 형식으로만 응답하세요.
{
  "nudges": [
    {
      "id": "고유 ID",
      "nudgeType": ${allowedTypes},
      "track": "${track}",
      "context": "현재 상황에 대한 쉬운 진단 (1문장)",
      "question": "사용자에게 던지는 핵심 질문 (1문장, 예: '결제 과정을 더 단순하게 줄여볼까요?')",
      "hypothesis": "이 제안을 선택했을 때의 기대 효과 (비전공자도 이해할 수 있는 쉬운 설명)",
      "actionPrompt": "이 아이디어를 시스템에 추가하기 위한 구체적인 행동 지침"
    }
  ]
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nudges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                nudgeType: { type: Type.STRING },
                context: { type: Type.STRING },
                question: { type: Type.STRING },
                hypothesis: { type: Type.STRING },
                actionPrompt: { type: Type.STRING }
              },
              required: ["id", "nudgeType", "context", "question", "hypothesis", "actionPrompt"]
            }
          }
        },
        required: ["nudges"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: '{"nudges": []}' } as any);
  
  if (!response || !response.text) {
    console.warn("Gemini returned empty response for nudges, returning empty array.");
    return [];
  }

  try {
    const jsonStr = response.text.trim();
    console.log("JSON String:", jsonStr);
    const parsed = JSON.parse(jsonStr).nudges as any[];
    console.log("Parsed:", parsed);
    if (!parsed) return [];
    return parsed.map(n => ({ ...n, track })) as ProactiveNudge[];
  } catch (e) {
    console.error("Failed to parse Nudges JSON", e);
    return [];
  }
};

const formatContext = (notes: Note[]) => {
  const relevantNotes = notes.filter(n => n.noteType === 'Domain' || n.noteType === 'Module');
  if (relevantNotes.length === 0) return '';
  return `\n[현재 프로젝트 맥락 (기존 도메인/모듈)]\n${relevantNotes.map(n => 
    `- [${n.noteType}] ${n.title}: ${n.summary}\n  (Pain: ${n.painPoint || 'N/A'}, Target: ${n.targetAudience || 'N/A'}, Solution: ${n.solutionPromise || 'N/A'})`
  ).join('\n')}`;
};

export const generateInitialPTS = async (input: string, existingNotes: Note[] = []): Promise<StrategyPillarOption[]> => {
  const context = formatContext(existingNotes);

  const prompt = `당신은 세계 최고의 비즈니스 전략가입니다.
사용자의 아이디어를 분석하여 다양한 관점을 가진 Pain-Target-Solution (PTS) 조합을 생성하세요.
${context}

[사용자 입력]
${input}

[작성 지침]
1. 각 조합은 독립적이어야 하며 서로 다른 비즈니스 관점을 가져야 합니다.
2. 비전공자도 이해할 수 있는 쉬운 한국어를 사용하세요.
3. 아이디어의 복잡도에 따라 충분한 개수(최소 5개 이상)를 생성하세요.
4. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "..."
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            painPoint: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            solutionPromise: { type: Type.STRING }
          },
          required: ["painPoint", "targetAudience", "solutionPromise"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" } as any);
  const result = JSON.parse(response.text || "[]");
  return result.map((r: any) => ({ ...r, id: crypto.randomUUID(), selected: false }));
};

export const generateMorePTS = async (existingPTS: StrategyPillarOption[], initialIdea: string = "", mode: 'industry' | 'idea' = 'industry'): Promise<StrategyPillarOption[]> => {
  const prompt = mode === 'industry' 
    ? `당신은 세계 최고의 비즈니스 전략가입니다.
기존에 제안된 PTS 조합들과 중복되지 않는 새로운 관점의 PTS 조합 3~5개를 추가로 생성하세요.
이번 확장은 [산업/분야 전체]의 관점에서, 해당 비즈니스 도메인에서 놓치고 있는 보편적이고 강력한 전략적 기회를 탐색하는 것입니다.

[기존 조합들 (중복 금지)]
${JSON.stringify(existingPTS.map(p => ({ painPoint: p.painPoint, targetAudience: p.targetAudience, solutionPromise: p.solutionPromise })), null, 2)}

[비즈니스 맥락]
${initialIdea}

[작성 지침]
1. 해당 산업군(Industry)의 트렌드와 베스트 프랙티스를 반영하여 새로운 관점을 제시하세요.
2. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "..."
  }
]`
    : `당신은 세계 최고의 비즈니스 전략가입니다.
사용자의 [초기 아이디어]에 깊게 의존하여, 그 철학과 핵심 가치를 더욱 구체화하거나 파생시킨 새로운 PTS 조합 3~5개를 추가로 생성하세요.

[사용자 초기 아이디어]
${initialIdea}

[기존 조합들 (중복 금지)]
${JSON.stringify(existingPTS.map(p => ({ painPoint: p.painPoint, targetAudience: p.targetAudience, solutionPromise: p.solutionPromise })), null, 2)}

[작성 지침]
1. 사용자의 초기 의도와 아이디어의 독창성을 극대화하는 방향으로 확장하세요.
2. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "..."
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            painPoint: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            solutionPromise: { type: Type.STRING }
          },
          required: ["painPoint", "targetAudience", "solutionPromise"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" } as any);
  const result = JSON.parse(response.text || "[]");
  return result.map((r: any) => ({ ...r, id: crypto.randomUUID(), selected: false }));
};

export const summarizeStrategicPillars = async (selectedPTS: StrategyPillarOption[]): Promise<{ painPoint: string, targetAudience: string, solutionPromise: string }> => {
  const prompt = `당신은 세계 최고의 비즈니스 전략가입니다.
사용자가 선택한 여러 개의 전략적 기회(PTS)들을 분석하여, 이를 하나의 응집력 있고 강력한 비즈니스 전략 요약으로 통합하세요.

[선택된 전략들]
${selectedPTS.map((pts, i) => `전략 ${i+1}:\n- Pain: ${pts.painPoint}\n- Target: ${pts.targetAudience}\n- Solution: ${pts.solutionPromise}`).join('\n\n')}

[작성 지침]
1. 나열식이 아닌, 전체를 관통하는 하나의 서사로 통합하세요.
2. 각 항목(Pain, Target, Solution)에 대해 너무 길지 않으면서도 핵심을 찌르는 문장들로 구성하세요.
3. 비전공자 창업자도 가슴이 뛸 만큼 매력적이고 전문적인 언어를 사용하세요.
4. 반드시 아래 JSON 형식으로 응답하세요:
{
  "painPoint": "...",
  "targetAudience": "...",
  "solutionPromise": "..."
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          painPoint: { type: Type.STRING },
          targetAudience: { type: Type.STRING },
          solutionPromise: { type: Type.STRING }
        },
        required: ["painPoint", "targetAudience", "solutionPromise"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}");
};

export const deepDivePTS = async (pts: StrategyPillarOption, initialIdea: string = ""): Promise<StrategyPillarOption[]> => {
  const prompt = `당신은 세계 최고의 비즈니스 전략가입니다.
다음 PTS 조합을 더 세분화하여 구체적인 하위 PTS 조합 3개를 생성하세요.

[프로젝트 핵심 테마]
${initialIdea}

[대상 PTS 조합]
- Pain: ${pts.painPoint}
- Target: ${pts.targetAudience}
- Solution: ${pts.solutionPromise}

[작성 지침]
1. 도메인 가드레일: 위 [프로젝트 핵심 테마]에서 정의된 도메인 맥락을 절대 벗어나지 마세요. 
2. 유연한 확장: 핵심 테마 안에서는 자유롭게 확장 가능하지만, 테마와 전혀 관련 없는 분야로 이탈하지 마세요.
3. 구체화: 대상을 더 좁히거나, Pain을 더 구체적인 상황으로 분해하세요. 추상적인 논리 패턴에만 매몰되지 말고 실제 사용자의 상황을 파고드세요.
4. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "..."
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            painPoint: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            solutionPromise: { type: Type.STRING }
          },
          required: ["painPoint", "targetAudience", "solutionPromise"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" } as any);
  const result = JSON.parse(response.text || "[]");
  return result.map((r: any) => ({ ...r, id: crypto.randomUUID(), selected: false }));
};

export const refinePillars = async (pillars: StrategyPillars, feedback: string): Promise<StrategyPillars> => {
  const prompt = `당신은 비즈니스 전략 전문가입니다. 기존의 전략 기둥을 사용자의 피드백을 반영하여 더 날카롭게 다듬으세요.

[기존 전략 기둥]
- 페인 포인트: ${pillars.painPoint}
- 타겟 고객: ${pillars.targetAudience}
- 해결 가설: ${pillars.solutionPromise}

[사용자 피드백]
${feedback}

[작성 지침]
1. 사용자의 의도를 정확히 반영하되, 비즈니스적 논리 구조를 유지하세요.
2. 여전히 쉽고 직관적인 한국어를 사용하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "painPoint": "...",
  "targetAudience": "...",
  "solutionPromise": "..."
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          painPoint: { type: Type.STRING },
          targetAudience: { type: Type.STRING },
          solutionPromise: { type: Type.STRING }
        },
        required: ["painPoint", "targetAudience", "solutionPromise"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}") as StrategyPillars;
};

export const generateDomainsWithPillars = async (selectedPTS: StrategyPillarOption[], existingNotes: Note[] = []) => {
  const context = formatContext(existingNotes);
  const ptsContext = selectedPTS.map((pts, i) => 
    `전략 ${i+1} (ID: ${pts.id}):\n- Pain: ${pts.painPoint}\n- Target: ${pts.targetAudience}\n- Solution: ${pts.solutionPromise}`
  ).join('\n\n');

  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
사용자가 선택한 다수의 핵심 전략(PTS)과 기존 프로젝트 맥락을 결합하여 최적의 시스템 도메인 구조 후보군을 설계하세요.

[설계 지침]
1. 전략적 매핑: 5~7개의 최상위 도메인을 제안해야 하며, 선택된 모든 전략적 기회(PTS)를 빠짐없이 커버해야 합니다.
2. 각 도메인은 어떤 PTS를 해결하기 위해 존재하는지 명확히 반영되어야 하며, 'coveredPtsIds' 배열에 해당 PTS의 ID를 포함해야 합니다.
3. 각 도메인의 이름(title)과 요약(summary)을 직관적인 한국어로 작성하세요.
4. 각 도메인별로 다음 3가지 필러를 정의하세요:
   - painPoint: 이 도메인이 해결하려는 구체적인 고통.
   - targetAudience: 이 도메인의 기능을 주로 사용할 사용자나 시스템 액터.
   - solutionPromise: 이 도메인이 제공하는 핵심 가치 제안.
5. 추가로 도메인 필수 필드인 boundaries, kpis, glossary를 마크다운 형식으로 작성하세요.
${context}

[선택된 다중 핵심 전략 (PTS)]
${ptsContext}

반드시 아래 JSON 형식으로만 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "painPoint": "...",
      "targetAudience": "...",
      "solutionPromise": "...",
      "boundaries": "...",
      "kpis": "...",
      "glossary": "...",
      "coveredPtsIds": ["pts-id-1", "pts-id-2"]
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          domains: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                painPoint: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                solutionPromise: { type: Type.STRING },
                boundaries: { type: Type.STRING },
                kpis: { type: Type.STRING },
                glossary: { type: Type.STRING },
                coveredPtsIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary", "coveredPtsIds"]
            }
          }
        },
        required: ["domains"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);
  const result = JSON.parse(response.text || "{}");
  const domains = (result.domains || []).map((d: any) => ({
    ...d,
    id: crypto.randomUUID(),
    selected: false
  }));
  return { domains };
};

export const generateMoreDomains = async (currentDomains: DomainCandidate[], selectedPTS: StrategyPillarOption[], existingNotes: Note[] = [], mode: 'industry' | 'idea' = 'industry'): Promise<DomainCandidate[]> => {
  const context = formatContext(existingNotes);
  const ptsContext = selectedPTS.map((pts, i) => 
    `전략 ${i+1} (ID: ${pts.id}):\n- Pain: ${pts.painPoint}\n- Target: ${pts.targetAudience}\n- Solution: ${pts.solutionPromise}`
  ).join('\n\n');

  const currentDomainsContext = currentDomains.map(d => `- ${d.title}: ${d.summary}`).join('\n');

  const prompt = mode === 'industry'
    ? `당신은 세계 최고의 소프트웨어 아키텍트입니다.
현재 설계된 도메인 리스트를 분석하여, 비즈니스 운영이나 확장성을 위해 '있으면 좋은데 놓치고 있는' 새로운 보조 도메인 후보 2~3개를 제안하세요. (수평 확장)

[현재 도메인 구성]
${currentDomainsContext}

[선택된 다중 핵심 전략 (PTS)]
${ptsContext}

[작성 지침]
1. 기존 도메인과 겹치지 않는 새로운 관점(예: 사용자 커뮤니티, 데이터 분석, 운영 관리 등)의 도메인을 제안하세요.
2. 해당 분야의 보편적이고 강한 전략을 반영한 도메인을 제안하세요.
3. 각 도메인은 어떤 PTS를 간접적으로라도 지원하는지 'coveredPtsIds'에 명시하세요.
4. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "title": "...",
    "summary": "...",
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "...",
    "boundaries": "...",
    "kpis": "...",
    "glossary": "...",
    "coveredPtsIds": ["pts-id-1"]
  }
]`
    : `당신은 세계 최고의 소프트웨어 아키텍트입니다.
현재 설계된 도메인 리스트를 분석하여, 초기 아이디어와 핵심 전략(PTS)을 더욱 깊게 파고드는 새로운 도메인 후보 2~3개를 제안하세요. (수평 확장)

[현재 도메인 구성]
${currentDomainsContext}

[선택된 다중 핵심 전략 (PTS)]
${ptsContext}

[작성 지침]
1. 기존 도메인과 겹치지 않으면서도, 초기 아이디어와 PTS의 철학/가치를 크게 반영한 특화된 도메인을 제안하세요.
2. 각 도메인은 어떤 PTS를 간접적으로라도 지원하는지 'coveredPtsIds'에 명시하세요.
3. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "title": "...",
    "summary": "...",
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "...",
    "boundaries": "...",
    "kpis": "...",
    "glossary": "...",
    "coveredPtsIds": ["pts-id-1"]
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            painPoint: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            solutionPromise: { type: Type.STRING },
            boundaries: { type: Type.STRING },
            kpis: { type: Type.STRING },
            glossary: { type: Type.STRING },
            coveredPtsIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary", "coveredPtsIds"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" } as any);
  const result = JSON.parse(response.text || "[]");
  return result.map((d: any) => ({
    ...d,
    id: crypto.randomUUID(),
    selected: false
  }));
};

export const generateDomainForSpecificPts = async (currentDomains: DomainCandidate[], pts: StrategyPillarOption, existingNotes: Note[] = []): Promise<DomainCandidate[]> => {
  const context = formatContext(existingNotes);
  const currentDomainsContext = currentDomains.map(d => `- ${d.title}: ${d.summary}`).join('\n');

  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
현재 설계된 도메인 리스트를 분석하고, 아직 해결되지 않은 특정 핵심 전략(PTS)을 전담하여 해결할 새로운 도메인 1~2개를 제안하세요.

[현재 도메인 구성]
${currentDomainsContext}

[해결해야 할 미반영 전략 (PTS)]
- ID: ${pts.id}
- Pain Point: ${pts.painPoint}
- Target Audience: ${pts.targetAudience}
- Solution Promise: ${pts.solutionPromise}

[작성 지침]
1. 위 미반영 전략을 직접적으로 해결할 수 있는 새로운 도메인을 제안하세요.
2. 기존 도메인과 역할이 중복되지 않도록 명확한 경계(Boundaries)를 설정하세요.
3. 제안된 도메인의 'coveredPtsIds' 배열에는 반드시 위 미반영 전략의 ID("${pts.id}")를 포함해야 합니다.
4. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "title": "...",
    "summary": "...",
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "...",
    "boundaries": "...",
    "kpis": "...",
    "glossary": "...",
    "coveredPtsIds": ["${pts.id}"]
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            painPoint: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            solutionPromise: { type: Type.STRING },
            boundaries: { type: Type.STRING },
            kpis: { type: Type.STRING },
            glossary: { type: Type.STRING },
            coveredPtsIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary", "coveredPtsIds"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" } as any);
  const result = JSON.parse(response.text || "[]");
  return result.map((d: any) => ({
    ...d,
    id: crypto.randomUUID(),
    selected: true // Automatically select the newly suggested domain for the PTS
  }));
};

export const splitDomain = async (domain: DomainCandidate): Promise<DomainCandidate[]> => {
  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
다음 도메인이 너무 많은 책임을 지고 있다고 판단하여, 이를 더 작고 관리하기 쉬운 하위 도메인 2~3개로 분리(Decomposition)하세요. (수직 확장)

[대상 도메인]
- Title: ${domain.title}
- Summary: ${domain.summary}
- Pain: ${domain.painPoint}
- Target: ${domain.targetAudience}
- Promise: ${domain.solutionPromise}
- Covered PTS IDs: ${domain.coveredPtsIds.join(', ')}

[작성 지침]
1. 대상 도메인의 책임을 논리적으로 분할하여 새로운 도메인들을 제안하세요.
2. 분할된 도메인들은 대상 도메인이 커버하던 PTS ID들을 적절히 나누어 가져야 합니다.
3. 반드시 아래 JSON 배열 형식으로 응답하세요:
[
  {
    "title": "...",
    "summary": "...",
    "painPoint": "...",
    "targetAudience": "...",
    "solutionPromise": "...",
    "boundaries": "...",
    "kpis": "...",
    "glossary": "...",
    "coveredPtsIds": ["..."]
  }
]`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            painPoint: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            solutionPromise: { type: Type.STRING },
            boundaries: { type: Type.STRING },
            kpis: { type: Type.STRING },
            glossary: { type: Type.STRING },
            coveredPtsIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary", "coveredPtsIds"]
        }
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "[]" } as any);
  const result = JSON.parse(response.text || "[]");
  return result.map((d: any) => ({
    ...d,
    id: crypto.randomUUID(),
    selected: false
  }));
};

export const deepenDomainPillars = async (domain: DomainCandidate): Promise<Partial<DomainCandidate>> => {
  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
다음 도메인의 핵심 3요소(Pain, Target, Promise)를 바탕으로, Boundaries(경계), KPIs(지표), Glossary(용어집)를 더 깊게 추론하여 상세 설계를 완성하세요. (Pillar Deepening)

[대상 도메인]
- Title: ${domain.title}
- Summary: ${domain.summary}
- Pain: ${domain.painPoint}
- Target: ${domain.targetAudience}
- Promise: ${domain.solutionPromise}

[작성 지침]
1. Boundaries: 이 도메인이 책임지는 영역과 책임지지 않는 영역(Out of scope)을 명확히 정의하세요.
2. KPIs: 이 도메인의 성공을 측정할 수 있는 핵심 성과 지표 3가지를 도출하세요.
3. Glossary: 이 도메인 내에서 사용되는 핵심 비즈니스 용어 3~5가지를 정의하세요.
4. 반드시 아래 JSON 형식으로 응답하세요:
{
  "boundaries": "...",
  "kpis": "...",
  "glossary": "..."
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          boundaries: { type: Type.STRING },
          kpis: { type: Type.STRING },
          glossary: { type: Type.STRING }
        },
        required: ["boundaries", "kpis", "glossary"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}");
};

export const generateModulesWithPillars = async (domainTitle: string, domainPillars: StrategyPillars & { boundaries?: string }, existingNotes: Note[] = []) => {
  const context = formatContext(existingNotes);

  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
'${domainTitle}' 도메인의 전략을 달성하기 위한 하위 모듈(Module)들을 설계하세요.
${context}

[도메인 전략 기둥]
- 페인 포인트: ${domainPillars.painPoint}
- 타겟 고객: ${domainPillars.targetAudience}
- 해결 가설: ${domainPillars.solutionPromise}
${domainPillars.boundaries ? `- 도메인 경계(Boundaries): ${domainPillars.boundaries}` : ''}

[작성 지침 - 매우 중요]
1. 각 모듈은 반드시 '${domainTitle}' 도메인의 **경계(Boundaries)** 내에 있어야 합니다. 경계를 벗어나는 기능은 설계하지 마세요.
2. 각 모듈의 이름(title)과 요약(summary)을 직관적인 한국어로 작성하세요.
3. 각 모듈별로 다음 3가지 필러를 정의하세요:
   - painPoint: 이 모듈이 해결하려는 구체적인 사용자 불편.
   - targetAudience: 이 모듈의 주 사용자.
   - solutionPromise: 이 모듈이 제공하는 구체적인 기능적 약속.
4. 추가로 모듈 필수 필드인 requirements, userJourney, ia를 마크다운 형식으로 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "modules": [
    {
      "title": "...",
      "summary": "...",
      "painPoint": "...",
      "targetAudience": "...",
      "solutionPromise": "...",
      "requirements": "...",
      "userJourney": "...",
      "ia": "..."
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          modules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                painPoint: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                solutionPromise: { type: Type.STRING },
                requirements: { type: Type.STRING },
                userJourney: { type: Type.STRING },
                ia: { type: Type.STRING }
              },
              required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "requirements", "userJourney", "ia"]
            }
          }
        },
        required: ["modules"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}") as { modules: any[] };
};

export const generateLogicsForModule = async (moduleTitle: string, modulePillars: StrategyPillars, existingNotes: Note[] = []) => {
  const context = existingNotes.length > 0 
    ? `\n[기존 설계 구조]\n${existingNotes.map(n => `- ${n.title} (${n.noteType})`).join('\n')}\n* 중요: 기존에 이미 설계된 로직이 있다면 중복되지 않도록 주의하세요.`
    : '';

  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
'${moduleTitle}' 모듈의 전략을 구현하기 위한 세부 로직(Logic)들을 설계하세요.
${context}

[모듈 전략 기둥]
- 페인 포인트: ${modulePillars.painPoint}
- 타겟 고객: ${modulePillars.targetAudience}
- 해결 가설: ${modulePillars.solutionPromise}

[작성 지침]
1. 각 로직의 이름(title)과 요약(summary)을 직관적인 한국어로 작성하세요.
2. 로직 필수 필드인 businessRules, constraints, ioMapping, edgeCases를 마크다운 형식으로 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "logics": [
    {
      "title": "...",
      "summary": "...",
      "businessRules": "...",
      "constraints": "...",
      "ioMapping": "...",
      "edgeCases": "..."
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          logics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                businessRules: { type: Type.STRING },
                constraints: { type: Type.STRING },
                ioMapping: { type: Type.STRING },
                edgeCases: { type: Type.STRING }
              },
              required: ["title", "summary", "businessRules", "constraints", "ioMapping", "edgeCases"]
            }
          }
        },
        required: ["logics"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}") as { logics: any[] };
};

export const refineDomains = async (currentDomains: any[], refineInput: string, existingNotes: Note[] = []) => {
  const context = formatContext(existingNotes);

  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
사용자의 요청에 따라 현재 설계된 도메인 구조를 개선하세요.
${context}

[현재 도메인 구조]
${currentDomains.map((d, i) => `${i+1}. ${d.title}: ${d.summary}`).join('\n')}

[사용자 수정 요청]
"${refineInput}"

반드시 아래 JSON 형식으로 모든 도메인 정보를 포함하여 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "painPoint": "...",
      "targetAudience": "...",
      "solutionPromise": "...",
      "boundaries": "...",
      "kpis": "...",
      "glossary": "..."
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          domains: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                painPoint: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                solutionPromise: { type: Type.STRING },
                boundaries: { type: Type.STRING },
                kpis: { type: Type.STRING },
                glossary: { type: Type.STRING }
              },
              required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary"]
            }
          }
        },
        required: ["domains"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}") as { domains: any[] };
};

export const refineModules = async (currentModules: any[], refineInput: string, existingNotes: Note[] = []) => {
  const context = formatContext(existingNotes);

  const prompt = `당신은 세계 최고의 소프트웨어 아키텍트입니다.
사용자의 요청에 따라 현재 설계된 모듈 구조를 개선하세요.
${context}

[현재 모듈 구조]
${currentModules.map((m, i) => `${i+1}. ${m.title}: ${m.summary}`).join('\n')}

[사용자 수정 요청]
"${refineInput}"

반드시 아래 JSON 형식으로 모든 모듈 정보를 포함하여 응답하세요:
{
  "modules": [
    {
      "title": "...",
      "summary": "...",
      "painPoint": "...",
      "targetAudience": "...",
      "solutionPromise": "...",
      "requirements": "...",
      "userJourney": "...",
      "ia": "..."
    }
  ]
}`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          modules: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                painPoint: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                solutionPromise: { type: Type.STRING },
                requirements: { type: Type.STRING },
                userJourney: { type: Type.STRING },
                ia: { type: Type.STRING }
              },
              required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "requirements", "userJourney", "ia"]
            }
          }
        },
        required: ["modules"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 45000, { text: "{}" } as any);
  return JSON.parse(response.text || "{}") as { modules: any[] };
};

export const generateDomainRefinementSuggestions = async (currentDomains: any[]) => {
  const prompt = `당신은 도메인 설계를 더 날카롭게 다듬어주는 전략 컨설턴트입니다.
현재 설계된 도메인들을 분석하여, 사용자가 고려해볼 만한 3~4개의 구체적인 수정 방향(Suggestion)을 제안하세요.

[현재 도메인 구조]
${currentDomains.map((d, i) => `${i+1}. ${d.title}: ${d.summary}`).join('\n')}

[작성 지침]
1. 각 제안은 15자 이내의 짧은 문구로 작성하세요. (예: "수익 모델 강화", "보안 정책 구체화", "사용자 경험 단순화")
2. 사용자가 클릭하고 싶을 만큼 매력적이고 구체적인 제안이어야 합니다.
3. 한국어로 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "suggestions": ["제안1", "제안2", "제안3"]
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const response = await withTimeout(responsePromise, 20000, { text: "{}" } as any);
  try {
    const result = JSON.parse(response.text || "{}");
    return result.suggestions || [];
  } catch (e) {
    return [];
  }
};

export const generateModuleRefinementSuggestions = async (domainTitle: string, currentModules: any[]) => {
  const prompt = `당신은 모듈 설계를 더 날카롭게 다듬어주는 UX/아키텍처 전문가입니다.
'${domainTitle}' 도메인 내의 모듈들을 분석하여, 사용자가 고려해볼 만한 3~4개의 구체적인 수정 방향(Suggestion)을 제안하세요.

[현재 모듈 구조]
${currentModules.map((m, i) => `${i+1}. ${m.title}: ${m.summary}`).join('\n')}

[작성 지침]
1. 각 제안은 15자 이내의 짧은 문구로 작성하세요. (예: "예외 상황 보완", "데이터 흐름 최적화", "요구사항 구체화")
2. 사용자가 클릭하고 싶을 만큼 매력적이고 구체적인 제안이어야 합니다.
3. 한국어로 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "suggestions": ["제안1", "제안2", "제안3"]
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const response = await withTimeout(responsePromise, 20000, { text: "{}" } as any);
  try {
    const result = JSON.parse(response.text || "{}");
    return result.suggestions || [];
  } catch (e) {
    return [];
  }
};

export const generateBulkModuleSuggestions = async (domainTitle: string, modules: any[]) => {
  if (!modules || modules.length === 0) return {};
  
  const prompt = `당신은 UX/아키텍처 전문가입니다. '${domainTitle}' 도메인 내의 여러 모듈들에 대해 각각 3~4개의 수정 제안을 생성하세요.

[모듈 목록]
${modules.map((m, i) => `${i}. ${m.title}: ${m.summary}`).join('\n')}

[작성 지침]
1. 각 모듈별로 해당 모듈을 더 날카롭게 다듬을 수 있는 3~4개의 짧은 제안(15자 이내)을 작성하세요.
2. 결과는 각 모듈의 인덱스를 키로 하는 JSON 객체여야 합니다.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "suggestions": {
    "0": ["제안1", "제안2", "제안3"],
    "1": ["제안1", "제안2", "제안3"]
  }
}`;

  const responsePromise = ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const response = await withTimeout(responsePromise, 30000, { text: "{}" } as any);
  try {
    const result = JSON.parse(response.text || "{}");
    return result.suggestions || {};
  } catch (e) {
    return {};
  }
};

export const addFeatureBlueprint = async (nudge: ProactiveNudge, notes: Note[]) => {
  const prompt = `당신은 비전공자 창업자를 돕는 친절한 기술 파트너입니다.
현재 프로젝트의 상태와 AI의 제안을 바탕으로, 이 기능을 추가하기 위한 설계도를 작성하세요.

[AI의 제안 및 가설]
- 타입: ${nudge.nudgeType}
- 질문: ${nudge.question}
- 가설: ${nudge.hypothesis}
- 행동 제안: ${nudge.actionPrompt}

[현재 프로젝트 상태]
${notes.map(n => `- ${n.title} (${n.noteType})`).join('\n')}

[작성 지침 - 매우 중요]
1. 비전공자도 이해할 수 있도록 아주 쉬운 일상 언어를 사용하세요.
2. 기술 용어 대신 기능의 목적과 사용자 가치를 중심으로 설명하세요.
3. 제목과 요약은 직관적이어야 하며, 이 기능이 추가되었을 때 서비스가 어떻게 좋아지는지 설명하세요.
4. 구조는 반드시 Domain -> Module -> Logic 계층 구조여야 합니다.
5. 각 레벨별로 다음 필드를 반드시 포함하세요:
   - Domain: title, summary, painPoint, targetAudience, solutionPromise, boundaries, kpis, glossary
   - Module: title, summary, painPoint, targetAudience, solutionPromise, requirements, userJourney, ia
   - Logic: title, summary, businessRules, constraints, ioMapping, edgeCases

반드시 아래 JSON 형식으로만 응답하세요:
{
  "domains": [
    {
      "title": "...",
      "summary": "...",
      "painPoint": "...",
      "targetAudience": "...",
      "solutionPromise": "...",
      "boundaries": "...",
      "kpis": "...",
      "glossary": "...",
      "modules": [
        {
          "title": "...",
          "summary": "...",
          "painPoint": "...",
          "targetAudience": "...",
          "solutionPromise": "...",
          "requirements": "...",
          "userJourney": "...",
          "ia": "...",
          "logics": [
            {
              "title": "...",
              "summary": "...",
              "businessRules": "...",
              "constraints": "...",
              "ioMapping": "...",
              "edgeCases": "..."
            }
          ]
        }
      ]
    }
  ]
}
`;

  const responsePromise = ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          domains: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                painPoint: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                solutionPromise: { type: Type.STRING },
                boundaries: { type: Type.STRING },
                kpis: { type: Type.STRING },
                glossary: { type: Type.STRING },
                modules: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      painPoint: { type: Type.STRING },
                      targetAudience: { type: Type.STRING },
                      solutionPromise: { type: Type.STRING },
                      requirements: { type: Type.STRING },
                      userJourney: { type: Type.STRING },
                      ia: { type: Type.STRING },
                      logics: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            businessRules: { type: Type.STRING },
                            constraints: { type: Type.STRING },
                            ioMapping: { type: Type.STRING },
                            edgeCases: { type: Type.STRING }
                          },
                          required: ["title", "summary", "businessRules", "constraints", "ioMapping", "edgeCases"]
                        }
                      }
                    },
                    required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "requirements", "userJourney", "ia", "logics"]
                  }
                }
              },
              required: ["title", "summary", "painPoint", "targetAudience", "solutionPromise", "boundaries", "kpis", "glossary", "modules"]
            }
          }
        },
        required: ["domains"]
      }
    }
  });

  const response = await withTimeout(responsePromise, 60000, { text: "[]" } as any);
  if (!response || !response.text) {
    throw new Error("Failed to generate feature blueprint.");
  }

  try {
    const jsonStr = response.text.trim();
    return JSON.parse(jsonStr) as {
      domains: {
        title: string;
        summary: string;
        painPoint: string;
        targetAudience: string;
        solutionPromise: string;
        boundaries: string;
        kpis: string;
        glossary: string;
        modules: {
          title: string;
          summary: string;
          painPoint: string;
          targetAudience: string;
          solutionPromise: string;
          requirements: string;
          userJourney: string;
          ia: string;
          logics: { 
            title: string; 
            summary: string; 
            businessRules: string;
            constraints: string;
            ioMapping: string;
            edgeCases: string;
          }[];
        }[];
      }[];
    };
  } catch (e) {
    console.error("Failed to parse Feature Blueprint JSON", e);
    throw new Error("Invalid JSON format from AI.");
  }
};
