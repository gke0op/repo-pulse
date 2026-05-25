# Repo Pulse — GitHub Repo Health Scanner

**Instant, actionable repo health reports. $9 per scan.**

Repo Pulse analyzes any public GitHub repository and produces a structured report covering:

- **Code Quality** — LOC analysis, language distribution, large file detection
- **Security Scan** — eval() usage, exposed secrets, console.log in production
- **Architecture Review** — project structure, CI/CD, tests, documentation
- **Prioritized Recommendations** — know exactly what to fix first

## Try It

```bash
npx repo-pulse owner/repo
```

Or use the API:

```bash
curl -X POST https://your-deploy-url/api/scan/free \
  -H "Content-Type: application/json" \
  -d '{"repo": "expressjs/express"}'
```

## Deploy Your Own

```bash
git clone https://github.com/gke0op/repo-pulse.git
cd repo-pulse
npm install
STRIPE_SECRET_KEY=sk_xxx STRIPE_PRICE_ID=price_xxx node server.js
```

## API

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Landing page |
| `/api/health` | GET | Health check |
| `/api/checkout` | POST | Create Stripe checkout session |
| `/api/scan/free` | POST | Free scan (no Stripe) |
| `/api/scan/:id` | GET | Get scan results |
| `/api/report/:id` | GET | Download report as markdown |
| `/api/webhook` | POST | Stripe webhook |

## Tech

- Bare metal Node.js — zero framework dependencies
- Stripe for payments
- GitHub API for repo cloning and analysis
- Single-file deployment (~600 lines)

## License

MIT
