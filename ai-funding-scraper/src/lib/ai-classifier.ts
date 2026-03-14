/**
 * Keyword-based AI-native company classifier.
 *
 * A company is considered "AI-native" if:
 * 1. It has an AI-related sector/tag, OR
 * 2. Its description contains 2+ AI keyword matches, OR
 * 3. Its name contains a strong AI indicator
 */

const AI_SECTORS = new Set([
  "artificial intelligence",
  "machine learning",
  "ai",
  "deep learning",
  "generative ai",
  "gen ai",
  "natural language processing",
  "nlp",
  "computer vision",
  "robotics",
  "autonomous vehicles",
  "ai infrastructure",
  "mlops",
  "ai/ml",
  "conversational ai",
  "ai platform",
  "large language models",
  "ai agents",
  "ai safety",
  "ai hardware",
]);

const AI_KEYWORDS = [
  "artificial intelligence",
  "machine learning",
  "deep learning",
  "neural network",
  "nlp",
  "natural language processing",
  "natural language understanding",
  "computer vision",
  "generative ai",
  "gen ai",
  "genai",
  "llm",
  "large language model",
  "foundation model",
  "ai agent",
  "ai-powered",
  "ai-native",
  "ai-first",
  "ai-driven",
  "ai platform",
  "ml platform",
  "ml model",
  "gpt",
  "transformer",
  "diffusion model",
  "reinforcement learning",
  "autonomous",
  "robotics",
  "ai infrastructure",
  "mlops",
  "ai copilot",
  "ai assistant",
  "intelligent automation",
  "cognitive computing",
  "speech recognition",
  "image recognition",
  "recommendation engine",
  "predictive ai",
  "ai analytics",
  "ai chip",
  "ai accelerator",
  "neural",
  "embedding",
  "vector database",
  "vector search",
  "retrieval augmented",
  "rag",
  "fine-tuning",
  "model training",
  "inference",
  "ai safety",
  "alignment",
  "multimodal",
];

const STRONG_NAME_INDICATORS = [
  "ai",
  ".ai",
  "neural",
  "deep",
  "cognitive",
  "cortex",
  "synth",
  "robo",
];

export function isAINative(
  name: string,
  description?: string | null,
  sectors?: string[] | null,
  sourceUrl?: string | null
): boolean {
  // 1. Check sectors (strongest signal)
  if (sectors && sectors.length > 0) {
    for (const sector of sectors) {
      if (AI_SECTORS.has(sector.toLowerCase().trim())) return true;
    }
    // Also check partial matches
    for (const sector of sectors) {
      const lower = sector.toLowerCase();
      if (lower.includes("artificial intelligence") || lower.includes("machine learning")) {
        return true;
      }
    }
  }

  // 2. Check description for keyword density
  const descLower = (description || "").toLowerCase();
  let keywordHits = 0;

  for (const keyword of AI_KEYWORDS) {
    if (descLower.includes(keyword)) {
      keywordHits++;
      if (keywordHits >= 2) return true; // 2+ keyword matches in description
    }
  }

  // 3. Check company name
  const nameLower = name.toLowerCase();

  // Strong indicators in name
  for (const indicator of STRONG_NAME_INDICATORS) {
    if (
      nameLower.includes(indicator) &&
      // Avoid false positives like "chair" containing "ai"
      (indicator !== "ai" || nameLower.endsWith("ai") || nameLower.endsWith(".ai") ||
       nameLower.startsWith("ai") || nameLower.includes(" ai") || nameLower.includes("ai "))
    ) {
      return true;
    }
  }

  // 4. Check source URL for AI signals
  if (sourceUrl) {
    const urlLower = sourceUrl.toLowerCase();
    const urlAiSignals = ["ai-", "-ai", "/ai/", "/ai-", "artificial-intelligence",
      "machine-learning", "agentic", "llm", "generative", "neural", "robot"];
    const urlHits = urlAiSignals.filter(s => urlLower.includes(s)).length;
    if (urlHits >= 1) return true;
  }

  // 5. Combine weak signals: 1 keyword in description + name hint
  if (keywordHits >= 1 && hasNameHint(nameLower)) return true;

  return false;
}

function hasNameHint(name: string): boolean {
  const hints = [
    "tech", "data", "labs", "intelligence", "mind", "brain",
    "logic", "sense", "vision", "auto", "smart",
  ];
  return hints.some((h) => name.includes(h));
}

/**
 * Score how "AI-native" a company appears (0-100)
 */
export function aiNativeScore(
  name: string,
  description?: string | null,
  sectors?: string[] | null
): number {
  let score = 0;

  // Sector matches (up to 40 points)
  if (sectors) {
    for (const sector of sectors) {
      if (AI_SECTORS.has(sector.toLowerCase().trim())) {
        score += 20;
      }
    }
    score = Math.min(score, 40);
  }

  // Description keyword matches (up to 40 points)
  const descLower = (description || "").toLowerCase();
  let kwCount = 0;
  for (const keyword of AI_KEYWORDS) {
    if (descLower.includes(keyword)) kwCount++;
  }
  score += Math.min(kwCount * 8, 40);

  // Name indicators (up to 20 points)
  const nameLower = name.toLowerCase();
  for (const indicator of STRONG_NAME_INDICATORS) {
    if (nameLower.includes(indicator)) {
      score += 10;
      break;
    }
  }
  if (hasNameHint(nameLower)) score += 10;

  return Math.min(score, 100);
}
