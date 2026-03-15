/**
 * Add manual companies to the database.
 * These are companies the user wants to track even if they haven't raised recently.
 */

import { getDb, closeDb } from "./db";
import * as queries from "./db/queries";
import { normalizeName, extractDomain } from "./lib/normalize";

interface ManualCompany {
  name: string;
  website: string;
  sectors: string[];
  description?: string;
}

const MANUAL_COMPANIES: ManualCompany[] = [
  {
    name: "Fern",
    website: "https://buildwithfern.com",
    sectors: ["Developer Tools", "API"],
    description: "API development platform that generates SDKs, documentation, and server-side code from API definitions.",
  },
  {
    name: "Mintlify",
    website: "https://mintlify.com",
    sectors: ["Developer Tools", "Documentation"],
    description: "Modern documentation platform for developer teams with AI-powered features.",
  },
  {
    name: "Sanity",
    website: "https://sanity.io",
    sectors: ["Content Management", "SaaS"],
    description: "Composable content cloud platform. Structured content management system for digital experiences.",
  },
  {
    name: "Strapi",
    website: "https://strapi.io",
    sectors: ["Content Management", "Open Source"],
    description: "Open-source headless CMS to build customizable APIs. Node.js-based content management.",
  },
  {
    name: "Contentful",
    website: "https://contentful.com",
    sectors: ["Content Management", "SaaS", "Enterprise"],
    description: "Content platform for digital-first businesses. Headless CMS and content infrastructure.",
  },
  {
    name: "ElevenLabs",
    website: "https://elevenlabs.io",
    sectors: ["Artificial Intelligence", "Generative AI", "Audio"],
    description: "AI voice technology platform. Text-to-speech, voice cloning, and audio AI models.",
  },
  {
    name: "Exa",
    website: "https://exa.ai",
    sectors: ["Artificial Intelligence", "Search", "Developer Tools"],
    description: "AI-powered search engine API for developers. Semantic search across the web.",
  },
  {
    name: "Firecrawl",
    website: "https://firecrawl.dev",
    sectors: ["Developer Tools", "Web Scraping", "Artificial Intelligence"],
    description: "Web scraping API for AI applications. Converts any website to clean markdown or structured data.",
  },
  {
    name: "Jam.dev",
    website: "https://jam.dev",
    sectors: ["Developer Tools", "Bug Reporting"],
    description: "Bug reporting tool that captures browser logs, console errors, and reproduction steps automatically.",
  },
  {
    name: "Linear",
    website: "https://linear.app",
    sectors: ["Developer Tools", "Project Management", "SaaS"],
    description: "Issue tracking and project management tool for software teams. Built for speed and simplicity.",
  },
  {
    name: "Resend",
    website: "https://resend.com",
    sectors: ["Developer Tools", "Email", "SaaS"],
    description: "Email API for developers. Build, test, and send transactional emails with modern developer tools.",
  },
  {
    name: "Stilla",
    website: "https://stilla.com",
    sectors: ["Artificial Intelligence", "Robotics"],
    description: "AI and sensing technology company.",
  },
  {
    name: "Raycast",
    website: "https://raycast.com",
    sectors: ["Developer Tools", "Productivity", "Artificial Intelligence"],
    description: "Productivity tool for developers. Extensible launcher with AI features and team collaboration.",
  },
  {
    name: "Suno",
    website: "https://suno.com",
    sectors: ["Artificial Intelligence", "Generative AI", "Music"],
    description: "AI music generation platform. Create songs from text prompts using AI models.",
  },
  {
    name: "Sierra",
    website: "https://sierra.ai",
    sectors: ["Artificial Intelligence", "Enterprise", "Customer Experience"],
    description: "Conversational AI platform for enterprises. AI agents for customer experience.",
  },
  {
    name: "Decagon",
    website: "https://decagon.ai",
    sectors: ["Artificial Intelligence", "Customer Support", "Enterprise"],
    description: "AI-powered customer support platform. Enterprise generative AI agents for support teams.",
  },
  {
    name: "Plain",
    website: "https://plain.com",
    sectors: ["Developer Tools", "Customer Support", "SaaS"],
    description: "Customer support platform built for B2B SaaS. API-first support tool for technical teams.",
  },
  {
    name: "Medusa",
    website: "https://medusajs.com",
    sectors: ["E-Commerce", "Open Source", "Developer Tools"],
    description: "Open-source composable commerce platform. Node.js alternative to Shopify for developers.",
  },
  {
    name: "Hex",
    website: "https://hex.tech",
    sectors: ["Data Analytics", "Artificial Intelligence", "SaaS"],
    description: "Collaborative data workspace. SQL, Python, and no-code tools for data teams with AI assistance.",
  },
  {
    name: "Struct",
    website: "https://struct.ai",
    sectors: ["Artificial Intelligence", "Communication", "SaaS"],
    description: "AI-powered communication platform. Structured discussions and knowledge management.",
  },
  {
    name: "PaperClip",
    website: "https://paperclip.inc",
    sectors: ["Artificial Intelligence", "SaaS"],
    description: "AI-powered business solutions.",
  },
  {
    name: "QA Wolf",
    website: "https://qawolf.com",
    sectors: ["Developer Tools", "Testing", "QA"],
    description: "Automated QA testing as a service. Get 80% test coverage in weeks with AI-powered testing.",
  },
  {
    name: "RunLayer",
    website: "https://runlayer.com",
    sectors: ["Developer Tools", "Infrastructure"],
    description: "Developer infrastructure platform.",
  },
  {
    name: "Langdock",
    website: "https://langdock.com",
    sectors: ["Artificial Intelligence", "Enterprise", "LLM"],
    description: "Enterprise AI platform. Secure access to multiple LLMs with data privacy for enterprises.",
  },
  {
    name: "Dify",
    website: "https://dify.ai",
    sectors: ["Artificial Intelligence", "LLM", "Open Source", "AI Agents", "Enterprise"],
    description: "Open-source platform for building and deploying AI workflows and applications. LLM app development platform with visual orchestration, RAG, and agent capabilities.",
  },
  {
    name: "Humand",
    website: "https://humand.co",
    sectors: ["HR Tech", "SaaS", "Artificial Intelligence", "Enterprise"],
    description: "AI-powered employee experience platform for HR management, internal communication, talent development, and company culture. Used by 1,500+ companies connecting 1.6M employees.",
  },
];

async function addManualCompanies() {
  const db = getDb();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Adding manual companies to tracking database");
  console.log("═══════════════════════════════════════════════════════\n");

  let added = 0;
  let existing = 0;

  for (const company of MANUAL_COMPANIES) {
    const normalizedName = normalizeName(company.name);
    if (!normalizedName) {
      console.warn(`  Skipping "${company.name}" — could not normalize name`);
      continue;
    }

    // Check if already exists
    const existingCompany = queries.findCompanyByNormalizedName(db, normalizedName);
    if (existingCompany) {
      console.log(`  Already exists: ${company.name} (id: ${existingCompany.id})`);

      // Still update is_ai_native and merge sectors if needed
      const existingSectors = JSON.parse(existingCompany.sectors || "[]") as string[];
      const mergedSectors = [...new Set([...existingSectors, ...company.sectors])];

      const existingSources = JSON.parse(existingCompany.sources || "[]") as string[];
      if (!existingSources.includes("manual")) existingSources.push("manual");

      db.prepare(`
        UPDATE companies SET
          is_ai_native = 1,
          sectors = $sectors,
          sources = $sources,
          description = COALESCE(description, $desc),
          website = COALESCE(website, $website),
          domain = COALESCE(domain, $domain),
          updated_at = datetime('now')
        WHERE id = $id
      `).run({
        $id: existingCompany.id,
        $sectors: JSON.stringify(mergedSectors),
        $sources: JSON.stringify(existingSources),
        $desc: company.description || null,
        $website: company.website,
        $domain: extractDomain(company.website),
      });

      existing++;
      continue;
    }

    const domain = extractDomain(company.website);

    // Also check by domain
    if (domain) {
      const domainMatch = queries.findCompanyByDomain(db, domain);
      if (domainMatch) {
        console.log(`  Domain match: ${company.name} → ${domainMatch.name} (id: ${domainMatch.id})`);
        existing++;
        continue;
      }
    }

    const id = queries.insertCompany(db, {
      name: company.name,
      normalized_name: normalizedName,
      description: company.description || null,
      website: company.website,
      domain,
      sectors: JSON.stringify(company.sectors),
      sources: JSON.stringify(["manual"]),
      is_ai_native: 1,
    });

    console.log(`  + Added: ${company.name} (id: ${id})`);
    added++;
  }

  console.log(`\n  Done! Added ${added} new companies, ${existing} already existed.\n`);
  console.log(`  Total AI-native companies: ${queries.getAllAINativeCompanies(db).length}`);

  closeDb();
}

if (import.meta.main) {
  await addManualCompanies();
}
