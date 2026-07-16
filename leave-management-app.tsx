PLANT LEAVE MANAGEMENT — V2 UPDATE

1. In Supabase:
   - Open SQL Editor
   - New query
   - Copy all of supabase/04_kiosk_api.sql
   - Click Run

2. In GitHub:
   - Open the plant-leave-management repository
   - Add file > Upload files
   - Open this extracted update folder
   - Drag ALL CONTENTS of the folder onto GitHub
   - Commit directly to main

3. Vercel will redeploy automatically.

This update:
- loads the 147 real employees from Supabase
- loads historical annual leave
- submits new annual-leave requests to Supabase
- adds employee overtime submission
- calculates overtime hours automatically
- keeps approvals read-only until secure manager/supervisor login is added
