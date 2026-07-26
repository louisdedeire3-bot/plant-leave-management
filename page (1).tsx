GREEN CHARCOAL NAMIBIA - FACTORY PORTAL V1

PURPOSE
This package creates one central Factory Portal for Management.

Manager navigation:
- Factory Dashboard
- Leave Management
- Screening
- Production
- Briquettes
- Laboratory
- Loading
- Maintenance
- Employees
- Reports
- Settings

CURRENT LIVE MODULES
- Leave Management: existing application
- Screening: fully integrated into the Factory Portal
- Incoming farmer loads: Management entry + Screening selection

INSTALLATION

1. Extract the CONTENTS of this ZIP at the root of:
   plant-leave-management

2. Allow these files to be added/replaced:
   components/factory-portal-app.tsx
   components/screening-factory-module.tsx
   components/leave-management-app.tsx
   app/factory/page.tsx
   app/screening/page.tsx

3. Do NOT replace:
   app/page.tsx

4. Run this file in the Supabase SQL Editor:
   Supabase/37_incoming_loads_and_screening_selection.sql

   SQL 36 must already have been run.

5. Commit the frontend files to GitHub and wait for Vercel.

ACCESS
Factory Portal:
  /factory

Old Screening address:
  /screening

The old /screening route now redirects to:
  /factory?module=screening

Leave Management:
  /

NAVIGATION
- Manager logs in once in /factory.
- Screening runs inside the central Factory Portal.
- Leave Management opens the existing live application.
- A Factory Portal button is added to the Leave Management header for Managers.
- Production, Briquettes, Laboratory, Loading and Maintenance are reserved as
  future modules and can be added without rebuilding the central navigation.

IMPORTANT
- The old components/screening-operations-app.tsx may remain in the repository.
  It is no longer used by app/screening/page.tsx.
- No new NPM dependency is required.
- Do not upload private password spreadsheets or private password SQL files.
