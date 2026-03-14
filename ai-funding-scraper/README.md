# AI Startup Job Search Pipeline

Automated pipeline for finding well-funded AI-native startups that are hiring, identifying recruiter contacts, and generating personalized outreach emails.

## How It Works

```
Funding Data (7 sources)  →  AI-Native Filter  →  Job Scraper  →  Recruiter Finder  →  Outreach CSV
```

1. **Scrape funding rounds** from TechCrunch, Crunchbase, Y Combinator, Exa.ai, VentureBeat, and more
2. **Classify** which companies are truly AI-native (not just "using AI")
3. **Find job openings** by scraping ATS platforms (Greenhouse, Lever, Ashby, Workable)
4. **Identify recruiters** and enrich with verified emails via Apollo.io
5. **Generate outreach** — personalized cold emails and LinkedIn messages, ready to send

## Quick Start

```bash
# Install dependencies
bun install

# Copy and fill in API keys
cp .env.example .env

# Run the full pipeline
bun run scrape           # 1. Collect funding rounds
bun run scrape:jobs      # 2. Find jobs + recruiters
bun run outreach         # 3. Generate outreach CSV
```

## Commands

| Command | What it does |
|---|---|
| `bun run scrape` | Scrape funding rounds from all sources |
| `bun run scrape:jobs` | Find job openings and recruiter contacts |
| `bun run find-recruiters` | Enrich recruiter emails (name+domain guessing) |
| `bun run find-recruiters:apollo` | Enrich via Apollo.io API (verified emails) |
| `bun run outreach` | Generate outreach CSV with personalized emails |
| `bun run add-companies` | Manually add companies to track |
| `bun run dev` | Start the dashboard API server |

## API Keys

| Key | Required | Source | Notes |
|---|---|---|---|
| `EXA_API_KEY` | Yes | [exa.ai](https://dashboard.exa.ai/api-keys) | Free tier: 1000 searches/month (~25 per scrape run) |
| `APOLLO_API_KEY` | Optional | [apollo.io](https://app.apollo.io/#/settings/integrations/api_keys) | Without it, emails are guessed from name+domain patterns |

## Output

The outreach command generates a CSV (`data/outreach-YYYY-MM-DD.csv`) with:

- Company info (name, sector, funding round, amount, investors)
- Recruiter contact (name, email, LinkedIn, verification status)
- Ready-to-send email (subject, body, follow-up, LinkedIn connection note)

Emails are timeliness-aware — the tone adjusts based on how recently the company raised.

## Data Sources

- **Exa.ai** — semantic search for AI funding announcements (highest volume)
- **TechCrunch RSS** — breaking funding news
- **Crunchbase** — RSS feed + web scraping
- **Y Combinator API** — YC company database
- **VentureBeat, Google News, SiliconAngle** — news RSS aggregation
- **AI Funding Tracker** — curated AI investment data

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Database:** SQLite (via Bun's native driver)
- **Dashboard:** React 19
- **APIs:** Exa.ai, Apollo.io, Crunchbase, Y Combinator

## Project Structure

```
src/
├── index.ts              # Main funding scraper
├── sources/              # 7 data source adapters
├── jobs/                 # Job scraping + recruiter finding
├── outreach/             # Email generation + templates
├── db/                   # SQLite schema + queries
├── api/                  # Dashboard REST API
├── lib/                  # AI classifier, dedup, normalization
└── dashboard.*           # React dashboard UI
data/
├── funding.sqlite        # Main database
└── outreach-*.csv        # Generated outreach files
```
