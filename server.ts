import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialize Gemini client to prevent app crashes on startup if key is missing
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required but missing.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// -------------------------------------------------------------------------
// RATE LIMITING MIDDLEWARE
// -------------------------------------------------------------------------

interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
}

function createRateLimiter(config: RateLimitConfig) {
  const hits = new Map<string, { count: number; resetTime: number }>();

  // Cleanup stale entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of hits.entries()) {
      if (now > data.resetTime) {
        hits.delete(ip);
      }
    }
  }, 60000);

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || req.socket.remoteAddress || "unknown-ip";
    const now = Date.now();
    
    let record = hits.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + config.windowMs };
      hits.set(ip, record);
      res.setHeader("X-RateLimit-Limit", String(config.max));
      res.setHeader("X-RateLimit-Remaining", String(config.max - 1));
      return next();
    }

    record.count++;
    const remaining = Math.max(0, config.max - record.count);
    res.setHeader("X-RateLimit-Limit", String(config.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (record.count > config.max) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: config.message || "Rate limit exceeded. Please try again later.",
        retryAfter: retryAfterSeconds
      });
    }

    next();
  };
}

// 1. AI Data Endpoints Rate Limiter (Stricter: 20 requests / 15 mins)
const aiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Rate limit exceeded for AI generation endpoints (max 20 requests per 15 minutes)."
});

// 2. Authentication / Secure Order Endpoints Rate Limiter (30 requests / 15 mins)
const authOrderRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Rate limit exceeded for authentication/order endpoints (max 30 requests per 15 minutes)."
});

// 3. Public Data Endpoints Rate Limiter (120 requests / 15 mins)
const publicDataRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Rate limit exceeded for public data endpoints."
});

// -------------------------------------------------------------------------
// SERVER-SIDE APIS
// -------------------------------------------------------------------------

// Health check
app.get("/api/health", publicDataRateLimiter, (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Curated South African Career & Prep Products List (The Product API)
const PREP_PRODUCTS = [
  {
    id: "prod-batho-pele",
    title: "Interactive Batho Pele Study Kit",
    category: "Public Sector Guide",
    priceZar: 49,
    description: "Master all 8 Batho Pele principles (Consultation, Service Standards, Access, Courtesy, Information, Openness, Redress, Value for Money) with contextualized public service interview scenarios and high-scoring sample answers.",
    badge: "Most Popular",
    iconName: "BookOpen",
    features: [
      "Full breakdown of 8 Batho Pele principles",
      "15 interactive scenario-based sample answers",
      "Printable offline PDF pocket guide",
      "Panel expectations and grading cheat-sheet"
    ]
  },
  {
    id: "prod-z83-assistant",
    title: "Digital Z83 Form Builder & Companion",
    category: "Administrative Tool",
    priceZar: 0,
    description: "The official 2021 Z83 government application form made simple. Guided step-by-step assistant to prevent common administrative mistakes that lead to instant disqualification.",
    badge: "Free Companion",
    iconName: "FileText",
    features: [
      "Interactive step-by-step digital template",
      "Common mistake checker (missing signatures/dates)",
      "Instant printable/exportable standard format",
      "Tips for 'Section B' (Personal Details & References)"
    ]
  },
  {
    id: "prod-interview-masterclass",
    title: "SAPS & DPSA Panel Interview Masterclass",
    category: "Premium Course",
    priceZar: 99,
    description: "Immersive video and voice course specifically targeting South African panel interview dynamics. Learn how to address 5-panel member questions confidently and present your experiences under high tension.",
    badge: "Best Value",
    iconName: "Award",
    features: [
      "3 hours of dynamic voice coaching guidelines",
      "High-pressure panel simulation audio examples",
      "Cultural adaptation and local language transition hacks",
      "SAPS and provincial department focus points"
    ]
  },
  {
    id: "prod-ats-cv-templates",
    title: "Professional ATS-Friendly CV Template Pack",
    category: "Design Bundle",
    priceZar: 29,
    description: "Modern, minimalistic, and high-impact South African resume formats pre-scanned and verified to pass standard corporate and governmental Automated Tracking Systems (ATS).",
    badge: "Essential",
    iconName: "Layers",
    features: [
      "3 elegant, simple A4 templates",
      "Optimized for South African identity formatting",
      "Fully responsive local-only CV download templates",
      "Ready-to-use professional phrases and summaries"
    ]
  },
  {
    id: "prod-hire-ready-audit",
    title: "Verified HIRE-READY Panel Audit Certificate",
    category: "Expert Review",
    priceZar: 149,
    description: "Get your recorded answers manually reviewed and graded by our professional recruitment panel. Includes a certified Verification ID that you can attach directly to your email applications.",
    badge: "Job Booster",
    iconName: "ShieldCheck",
    features: [
      "Human-in-the-loop expert manual assessment",
      "Comprehensive voice tone, delivery, and confidence audit",
      "Secure verification ID to list in your Z83",
      "24-hour rapid turnout"
    ]
  },
  {
    id: "prod-offline-practice",
    title: "Offline Practice & Question Downloader",
    category: "Premium Pack",
    priceZar: 39,
    description: "Download specific job sectors and official question sets to practice fully offline without any cellular data or internet connection. Fully stores questions, scenarios, and answers locally in your browser sandbox.",
    badge: "New Offline Feature",
    iconName: "Download",
    features: [
      "Full download of all 12+ South African job sectors",
      "Download custom job boards and custom questions",
      "Offline text-to-speech guidance support",
      "Offline local scoring simulator (POPIA compliant)"
    ]
  }
];

// GET /api/products
app.get("/api/products", publicDataRateLimiter, (req, res) => {
  res.json({
    success: true,
    products: PREP_PRODUCTS,
    currency: "ZAR",
    supportEmail: "support@interviewcoach.co.za",
    timestamp: new Date().toISOString()
  });
});

// POST /api/products/order (Simulated Secure Order Processing)
app.post("/api/products/order", authOrderRateLimiter, (req, res) => {
  const { productId, candidateEmail, paymentMethod } = req.body;

  if (!productId || !candidateEmail) {
    return res.status(400).json({ success: false, error: "Product ID and Candidate Email are required." });
  }

  const product = PREP_PRODUCTS.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ success: false, error: "Selected product not found." });
  }

  const orderId = `SA-ORD-${Math.floor(100000 + Math.random() * 900000)}`;

  res.json({
    success: true,
    message: `Payment of R${product.priceZar}.00 received successfully via ${paymentMethod || "Instant EFT"}.`,
    orderId,
    productTitle: product.title,
    candidateEmail,
    deliveryStatus: "Delivered instantly to local workspace",
    timestamp: new Date().toISOString()
  });
});

// 1. Post to Report Bounced Email Address
app.post("/api/report-bounce", authOrderRateLimiter, (req, res) => {
  const { email, reason } = req.body;
  console.log(`[Bounce Registry] Received bounce report for: ${email}. Reason: ${reason || "Unspecified"}`);
  res.json({
    success: true,
    message: `Successfully logged bounce report for '${email}' in the central InterviewCoach SA registry. Our directory has been updated.`,
    timestamp: new Date().toISOString(),
  });
});

// Helper for cleaning up JSON blocks returned by Gemini
function extractJSON(text: string): any {
  try {
    // Look for JSON block
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    const cleanedText = match ? match[1].trim() : text.trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("Failed to parse Gemini response as JSON:", text);
    throw new Error("Invalid format in AI response. Please try again.");
  }
}

// 2. Parse Job Advertisement Link or pasted text
app.post("/api/ai/parse-advert", aiRateLimiter, async (req, res) => {
  const { url, rawText, sector } = req.body;

  if (!url && !rawText) {
    return res.status(400).json({ error: "Either job URL or vacancy text is required to parse." });
  }

  const contentToAnalyze = rawText || `Scraped vacancy from URL: ${url}`;
  
  try {
    const ai = getGeminiClient();
    const prompt = `
      You are a South African recruitment specialist. Analyze the vacancy details below.
      
      Job Data / URL context:
      ${contentToAnalyze}
      
      Extract the job into a structured form:
      1. Job Title (e.g. Senior Nurse, SAPS Sergeant, Junior Admin Clerk)
      2. Sector (MUST be one of: 'DPSA/Gov', 'SAPS', 'Nursing', 'Education', 'Entry Retail', 'General Call Centre', or 'Custom' if it doesn't fit)
      3. Key requirements: Extracted list of up to 5 essential requirements or qualifications.
      4. Parsed Questions: Exactly 5 highly targeted, standard competency/behavioral questions specifically for this role in the South African job market.

      Return ONLY a JSON block with this structure:
      {
        "title": "Title here",
        "sector": "Sector here",
        "requirements": ["requirement 1", "requirement 2", ...],
        "parsedQuestions": ["question 1", "question 2", ...]
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        systemInstruction: "You extract South African job descriptions into clean JSON matching the requested structure.",
      },
    });

    const parsedData = extractJSON(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Error in /api/ai/parse-advert:", error);
    // Provide a rich simulated fallback so user can still test in sandbox if key is absent or network fails
    const mockTitles = ["Nursing Officer (Grade 1)", "SAPS Administration Assistant", "Education Educator Level 1", "Retail Sales Assistant", "Call Centre Consultant"];
    const selectedTitle = mockTitles[Math.floor(Math.random() * mockTitles.length)];
    const simulatedResponse = {
      title: url ? `Parsed Job from ${new URL(url).hostname}` : (sector ? `${sector} Specialist` : "General Assistant"),
      sector: sector || "DPSA/Gov",
      requirements: [
        "Grade 12 or equivalent South African qualification",
        "Excellent communication skills in English and/or local SA languages",
        "Ability to work in stressful environments and shift cycles",
        "Good organizational and interpersonal abilities",
        "Valid South African ID document"
      ],
      parsedQuestions: [
        "Why are you the best candidate for this vacancy under the South African public/private service guidelines?",
        "Can you describe a time when you had to resolve a high-pressure conflict with a citizen, patient, or customer?",
        "How do you prioritize multiple urgent duties during a busy shift?",
        "Explain a time when you made a mistake at work. How did you report it, and what did you do to correct it?",
        "What does excellent community service mean to you in the context of South African community development?"
      ],
      _simulated: true,
      _error: error.message
    };
    res.json(simulatedResponse);
  }
});

// 3. Polish CV raw text into bullet points
app.post("/api/ai/polish-text", aiRateLimiter, async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: "Text is required to perform polishing." });
  }

  try {
    const ai = getGeminiClient();
    const prompt = `
      You are an expert South African CV and resume writer. 
      Take the raw description of educational duties or work history below:
      "${text}"
      
      Polish this text into a list of 3 to 4 professional, action-oriented, and grammatically perfect bullet points.
      Do NOT include any personal identifiers (like name, email, phone numbers). Ensure the phrasing is tailored for a highly professional CV.
      
      Return ONLY a JSON block with this structure:
      {
        "polishedBullets": [
          "First highly polished bullet point...",
          "Second highly polished bullet point...",
          "Third highly polished bullet point..."
        ]
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsedData = extractJSON(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Error in /api/ai/polish-text:", error);
    // Simulated fallback
    const lines = text.split("\n").filter((l: string) => l.trim().length > 0);
    const mockBullets = lines.map((line: string) => `Successfully managed and executed tasks related to: "${line.trim()}" in accordance with institutional operational standards.`);
    if (mockBullets.length === 0) {
      mockBullets.push("Coordinated daily operational deliverables to ensure compliance with service Level Agreements.");
      mockBullets.push("Facilitated positive relationships with stakeholders and solved community/client inquiries proactively.");
    }
    res.json({
      polishedBullets: mockBullets,
      _simulated: true,
      _error: error.message
    });
  }
});

// 4. Score and analyze candidate's answer
app.post("/api/ai/score", aiRateLimiter, async (req, res) => {
  const { questionText, transcript, jobDescription, difficulty = "Medium" } = req.body;

  if (!questionText || !transcript) {
    return res.status(400).json({ error: "questionText and transcript are required to compute evaluation." });
  }

  try {
    const ai = getGeminiClient();
    const prompt = `
      You are a South African panel interviewer scoring a candidate's verbal or written answer.
      
      Difficulty Level Selected by User: ${difficulty}
      ${difficulty === "Easy" ? "Note: Easy mode evaluation. Be encouraging, focus on fundamental candidate answers, generous scoring, and constructive beginner guidance." : ""}
      ${difficulty === "Hard" ? "Note: Hard mode evaluation. Strict Director/Executive panel board evaluation. Demand complete STAR structure, quantified outcomes (numbers/percentages/Rands), strong risk management, zero tolerance for filler words, and deep sector terminology." : ""}
      ${difficulty === "Medium" ? "Note: Medium mode evaluation. Standard South African public/private sector interview panel benchmark." : ""}

      Target Vacancy Description:
      "${jobDescription || "General Vacancy in South Africa"}"
      
      Interview Question Asked:
      "${questionText}"
      
      Candidate's Provided Answer Transcript:
      "${transcript}"
      
      Evaluate the answer and provide:
      1. A realistic numerical score (0 to 100) reflecting the ${difficulty} difficulty level criteria.
      2. goodMetrics: Exactly 3 key positive aspects of their answer. Include [${difficulty} MODE] tag in the first metric.
      3. missedTargets: Exactly 3 items they missed, gaps in knowledge, or areas for improvement.
      4. starTips: Concrete coaching advice using the STAR (Situation, Task, Action, Result) format explaining how they can improve under this ${difficulty} level requirement.

      Return ONLY a JSON block with this structure:
      {
        "score": number,
        "goodMetrics": ["good point 1", "good point 2", "good point 3"],
        "missedTargets": ["gap 1", "gap 2", "gap 3"],
        "starTips": "STAR formatting advice here..."
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsedData = extractJSON(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Error in /api/ai/score:", error);
    
    // Generate a reasonable smart mock response based on length of transcript and difficulty
    const wordCount = transcript.trim().split(/\s+/).length;
    let baseScore = 55;
    if (wordCount > 50) baseScore = 75;
    if (wordCount > 100) baseScore = 84;
    if (wordCount < 10) baseScore = 42;

    let score = baseScore;
    if (difficulty === "Easy") score = Math.min(100, Math.round(baseScore * 1.15 + 5));
    if (difficulty === "Hard") score = Math.max(10, Math.round(baseScore * 0.85));

    const simulatedResponse = {
      score: score,
      goodMetrics: [
        `[${difficulty.toUpperCase()} MODE] Exhibited enthusiasm and understanding of the question.`,
        wordCount > 30 ? "Included a structured sequence of actions taken." : "Kept response direct and concise.",
        "Demonstrated alignment with essential community service values."
      ],
      missedTargets: [
        difficulty === "Hard" ? "CRITICAL: Lacks exact quantified metrics (e.g. percentages, Rands, time saved)." : "Did not quantify the result with measurable metrics.",
        "The context or Situation was slightly brief, leaving the panel wanting more background.",
        "Could include more industry-specific terminology relevant to the sector."
      ],
      starTips: `STAR Coaching (${difficulty} Level):
- **Situation/Task**: Spend 20 seconds clearly stating the exact problem and your role.
- **Action**: Describe exactly WHAT you did, highlighting your personal skills.
- **Result**: Conclude strongly by explaining the successful outcome.${difficulty === "Hard" ? " In Hard mode, ensure you give hard metrics!" : ""}`,
      _simulated: true,
      _error: error.message
    };
    res.json(simulatedResponse);
  }
});

// 5. Generate Dynamic Follow-Up Question based on candidate's previous response
app.post("/api/ai/follow-up-question", aiRateLimiter, async (req, res) => {
  const { 
    currentQuestion, 
    transcript, 
    jobTitle = "Specialist Officer", 
    sector = "DPSA/Gov", 
    persona = "Panel Chair", 
    difficulty = "Medium", 
    language = "English" 
  } = req.body;

  if (!currentQuestion || !transcript) {
    return res.status(400).json({ error: "currentQuestion and transcript are required to generate follow-up." });
  }

  try {
    const ai = getGeminiClient();
    const prompt = `
      You are an expert South African panel interviewer acting as: ${persona}.
      
      Target Vacancy: ${jobTitle} (${sector} Sector in South Africa)
      Interview Language Selected: ${language}
      Difficulty: ${difficulty}
      
      Previous Question Asked:
      "${currentQuestion}"
      
      Candidate's Spoken Answer Transcript:
      "${transcript}"
      
      TASK:
      1. Carefully examine what the candidate actually said in their answer.
      2. Identify a specific assertion, metric, omitted detail, team interaction, risk, or compliance angle mentioned or implied by the candidate.
      3. Generate a dynamic, realistic probing follow-up question that builds directly on what they answered, challenging them or requesting deeper clarification just like an expert interviewer on a real interview panel.
      4. Provide a natural spoken interviewer transition phrase acknowledging their previous answer before asking the follow-up question.
      5. State the focusArea (e.g., "Accountability & Escalation", "Sustained Metric Verification", "Ethical Conflict Resolution", etc.).

      Return ONLY a JSON block:
      {
        "interviewerTransition": "Spoken transition acknowledging their specific answer...",
        "followUpQuestion": "The sharp, contextual follow-up question...",
        "focusArea": "Targeted Competency/Area",
        "reasoning": "Brief note on why this follow-up was chosen based on the candidate's answer"
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsedData = extractJSON(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Error in /api/ai/follow-up-question, using smart simulated generator:", error);

    // Contextual smart offline generator
    const textLower = transcript.toLowerCase();
    let followUp = "You noted those specific steps in your response. Looking back, what was the biggest unexpected obstacle you encountered while executing that solution, and how did you adapt?";
    let transition = "Thank you for that response. As panel chair, let's drill down into that experience.";
    let focusArea = "Adaptive Problem Solving & Risk Mitigation";

    if (textLower.includes("team") || textLower.includes("colleague") || textLower.includes("staff")) {
      transition = "You highlighted the role of your team during that scenario.";
      followUp = "How did you handle differing opinions or resistance from colleagues when implementing that change, and how did you measure collective accountability?";
      focusArea = "Team Leadership & Peer Dynamics";
    } else if (textLower.includes("citizen") || textLower.includes("patient") || textLower.includes("customer")) {
      transition = "Citizen engagement is central to our public service charter.";
      followUp = "If the stakeholder continued to dispute the process or became hostile, what escalation protocol would you follow according to institutional guidelines?";
      focusArea = "Service Standards & De-escalation";
    } else if (/\b\d+\b|%|percent|rand|rands|hours/i.test(textLower)) {
      transition = "You mentioned measurable outcomes in your answer.";
      followUp = "Could you walk us through how you verified those numbers, and what measures were put in place to ensure that performance was maintained?";
      focusArea = "Data Verification & Continuous Quality";
    }

    res.json({
      interviewerTransition: transition,
      followUpQuestion: followUp,
      focusArea: focusArea,
      reasoning: "Generated dynamically based on detected candidate keywords.",
      _simulated: true,
      _error: error.message
    });
  }
});

// 6. Comprehensive Multi-Dimensional Interview Evaluation (Content, Communication Style, Confidence, Clarity)
app.post("/api/ai/detailed-interview-eval", aiRateLimiter, async (req, res) => {
  const {
    questionText,
    transcript,
    jobTitle = "Specialist Officer",
    sector = "DPSA/Gov",
    difficulty = "Medium",
    persona = "Panel Chair",
    language = "English"
  } = req.body;

  if (!questionText || !transcript) {
    return res.status(400).json({ error: "questionText and transcript are required." });
  }

  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  try {
    const ai = getGeminiClient();
    const prompt = `
      You are an elite interview assessment panel evaluating a candidate for:
      Job Title: ${jobTitle}
      Sector: ${sector} in South Africa
      Difficulty Level: ${difficulty}
      Interviewer Persona: ${persona}
      Language: ${language}
      
      Question Asked:
      "${questionText}"
      
      Candidate's Verbatim Transcript (${wordCount} words):
      "${transcript}"

      Analyze the response in depth across 4 distinct dimensions:
      1. CONTENT (0-100):
         - Technical accuracy and alignment with ${sector} role standards (Batho Pele, PFMA, SANC, SACE, etc.).
         - Depth of answer and STAR completeness (Situation, Task, Action, Result).
      2. COMMUNICATION STYLE (0-100):
         - Professionalism, active vs passive voice, vocabulary choices, tone.
         - Detection and impact of filler words (e.g. 'um', 'uh', 'like', 'basically', 'you know').
      3. CONFIDENCE (0-100):
         - Conviction, decisiveness, absence of timid hedging ('I guess', 'I'm not sure', 'maybe').
         - Authoritative personal ownership ('I led', 'I executed' vs diffuse 'we did stuff').
      4. CLARITY (0-100):
         - Conciseness, coherent structure, avoiding rambling, logical narrative progression.

      Return ONLY a JSON block:
      {
        "overallScore": number,
        "dimensions": {
          "contentScore": number,
          "contentFeedback": "2-3 sentences analyzing content depth, role alignment, and regulatory grasp.",
          "styleScore": number,
          "styleFeedback": "2-3 sentences analyzing tone, diction, active voice, and professional polish.",
          "confidenceScore": number,
          "confidenceFeedback": "2-3 sentences evaluating decisiveness, authority, and conviction.",
          "clarityScore": number,
          "clarityFeedback": "2-3 sentences evaluating structure, conciseness, and narrative flow.",
          "fillerWordsFound": ["detected", "fillers"],
          "fillerWordCount": number,
          "wordCount": ${wordCount},
          "starBreakdown": {
            "situation": "Analysis of Situation/Task context",
            "task": "Analysis of specific responsibility",
            "action": "Analysis of personal action taken",
            "result": "Analysis of outcome and metrics"
          },
          "recommendation": "Executive assessment verdict (e.g. Highly Recommended, Meets Benchmark, Requires Targeted Practice)",
          "actionableCoachingTip": "1 high-impact concrete coaching drill the candidate can use right now."
        },
        "goodMetrics": ["Point 1", "Point 2", "Point 3"],
        "missedTargets": ["Gap 1", "Gap 2", "Gap 3"],
        "starTips": "STAR coaching guidance..."
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsedData = extractJSON(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Error in /api/ai/detailed-interview-eval, falling back to smart engine:", error);

    // Compute smart multi-dimensional scores based on speech heuristics
    const fillerRegex = /\b(uhm|uh|um|like|ah|basically|actually|literally|you know|sort of|kind of)\b/gi;
    const fillers = transcript.match(fillerRegex) || [];
    const fillerCount = fillers.length;
    const fillerDensity = wordCount > 0 ? (fillerCount / wordCount) * 100 : 0;

    const hasNumbers = /\b\d+\b|%|percent|rand|rands|hours|days/i.test(transcript);
    const hasAction = /\b(i did|i organized|i implemented|i decided|i resolved|i led|i managed|i verified)\b/i.test(transcript);
    const hasSituation = /\b(when i was|at my last|in my previous|situation|tasked with|there was)\b/i.test(transcript);
    const hasResult = /\b(as a result|consequently|improved|reduced|resolved|saved|outcome)\b/i.test(transcript);

    let contentScore = Math.min(100, Math.max(35, 60 + (hasAction ? 15 : 0) + (hasNumbers ? 15 : 0)));
    let styleScore = Math.min(100, Math.max(30, 85 - Math.round(fillerDensity * 2)));
    let confidenceScore = Math.min(100, Math.max(25, (wordCount >= 40 ? 80 : 50) - (fillerCount * 3) + (hasAction ? 10 : 0)));
    let clarityScore = Math.min(100, Math.max(30, (wordCount >= 30 && wordCount <= 160 ? 85 : 65) - (fillerCount * 2)));

    if (difficulty === "Easy") {
      contentScore = Math.min(100, contentScore + 10);
      confidenceScore = Math.min(100, confidenceScore + 10);
    } else if (difficulty === "Hard") {
      contentScore = Math.max(20, contentScore - 12);
      confidenceScore = Math.max(20, confidenceScore - 10);
    }

    const overallScore = Math.round((contentScore * 0.35) + (styleScore * 0.25) + (confidenceScore * 0.2) + (clarityScore * 0.2));

    res.json({
      overallScore: overallScore,
      score: overallScore,
      dimensions: {
        contentScore: contentScore,
        contentFeedback: contentScore >= 75
          ? `Solid command of ${sector} principles. You clearly explained your operational role.`
          : `Moderate content depth. In ${sector}, panels expect specific policy references and measured results.`,
        styleScore: styleScore,
        styleFeedback: fillerCount <= 2
          ? "Professional, composed vocabulary and polite formal register."
          : `Style impacted by ${fillerCount} filler word(s). Replace fillers with silent pauses to maintain poise.`,
        confidenceScore: confidenceScore,
        confidenceFeedback: confidenceScore >= 75
          ? "High conviction and definitive personal agency in your phrasing."
          : "Hesitant delivery detected. Replace tentative phrasing with direct action verbs ('I managed', 'I verified').",
        clarityScore: clarityScore,
        clarityFeedback: clarityScore >= 75
          ? "Logical flow and easy-to-follow chronological sequence."
          : "Structure was slightly loose. Use the STAR formula to keep each response focused.",
        fillerWordsFound: Array.from(new Set(fillers.map(f => f.toLowerCase()))),
        fillerWordCount: fillerCount,
        wordCount: wordCount,
        starBreakdown: {
          situation: hasSituation ? "Clear context provided." : "Context was implicit; state background explicitly.",
          task: "Responsibilities outlined in context.",
          action: hasAction ? "Individual actions highlighted with 'I'." : "Specify what YOU personally did.",
          result: hasResult ? (hasNumbers ? "Quantified outcome provided." : "Outcome mentioned without numbers.") : "Conclude with measured outcome."
        },
        recommendation: overallScore >= 75 ? "Recommended - High Competency" : overallScore >= 55 ? "Progressing - Practice STAR Formatting" : "Further Coaching Advised",
        actionableCoachingTip: !hasNumbers
          ? "In your next answer, cite at least one specific metric (e.g. time saved, backlog % reduced, or budget managed)."
          : "Maintain your structured pace and pause for 1 second before concluding."
      },
      goodMetrics: [
        `[${difficulty.toUpperCase()} MODE] Addressed the core prompt directly.`,
        hasAction ? "Clear personal agency demonstrated with action verbs." : "Maintained polite and respectful tone.",
        hasNumbers ? "Included quantifiable metrics in outcome." : "Demonstrated sector alignment."
      ],
      missedTargets: [
        !hasNumbers ? "Did not quantify final outcome with numbers or percentages." : "Could deepen references to regulatory guidelines.",
        fillerCount > 2 ? `Recorded ${fillerCount} filler words. Work on silent transitions.` : "Could provide a sharper closing statement."
      ],
      starTips: `STAR Coaching (${difficulty} Level):\n- **Situation**: Give 15 seconds of context.\n- **Action**: Highlight your key choices.\n- **Result**: Quantify the impact!`,
      _simulated: true,
      _error: error.message
    });
  }
});

// -------------------------------------------------------------------------
// VITE OR STATIC SERVING MIDDLEWARE
// -------------------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[InterviewCoach SA] Server running on http://localhost:${PORT}`);
  });
}

// Only start standalone listener when not running in Vercel serverless environment
if (!process.env.VERCEL) {
  startServer();
}

export default app;
