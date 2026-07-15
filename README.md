# Plant Leave Management

Next.js prototype for factory annual leave management.

## Current features

- Employee search by first name, surname, nickname or employee ID
- Employee leave balance and history
- Annual leave request form
- Saturday counted as leave; Sunday excluded
- Supervisor approval followed by manager approval
- Weekly calendar with department filter
- English and draft Oshiwambo translations
- Local browser storage for demo requests
- Initial Supabase database schema
- GitHub Actions build workflow

## Run locally

Install Node.js 22, then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Push to a private GitHub repository

Create a private repository named `plant-leave-management`, then run from this folder:

```bash
git init
git add .
git commit -m "Initial leave management app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/plant-leave-management.git
git push -u origin main
```

## Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Add the Supabase project URL and anonymous key.

The current interface still uses demo data. The next step is replacing local data with Supabase queries and adding secure supervisor/manager authentication.
