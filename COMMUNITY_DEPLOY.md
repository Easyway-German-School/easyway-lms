# Community Feature - Quick Fix Checklist

## 🚀 Deploy These Commands

Copy and run in order:

```bash
# 1. Ensure database schema is current
npm --prefix prototype run db:migrate

# 2. Seed community spaces for all branches + levels
npm --prefix prototype run seed:spaces

# 3. Verify everything is working
npm --prefix prototype run verify:community
```

## ✅ Verification

After running the commands above, you should see:
- ✅ `X spaces created/updated`
- ✅ `Y channels created`
- ✅ Database now has Z spaces total, W channels total
- ✅ "Seeding complete! Students can now access the community."

## 🧪 Test It Works

Run the full test suite:
```bash
npm --prefix prototype run test:community
```

Should see:
- ✅ All tests passed! Community feature is fully functional.
- ✅ 20+ test cases covering authorization, threads, comments, unread, permissions

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| "No branches found" | Create a branch in admin panel first |
| "No student levels found" | Enroll students with levels first |
| Spaces still empty | Run `npm --prefix prototype run seed:spaces` again |
| Verification script shows errors | Run: `npm --prefix prototype run verify:community --fix` |
| API still returning 500 error | Check logs in dev mode (includes error details) |

## 📱 Test as Student

1. Login as a student whose branch + level are set
2. Look for **smiley icon** in bottom-right corner
3. Click it → should show:
   - Your space (e.g., "Abuja - Level A1")
   - 5 channels: General, Grammar Help, Vocabulary, Announcements, Assignment Support
   - Ability to create threads and reply

4. Should NOT see: "Unable to load community spaces"

## 👨‍🏫 Test as Staff

1. Login as a lecturer or admin
2. Click smiley icon → should show:
   - **ALL spaces** (not just one)
   - All branches and levels
   - Can read and post in all channels
   - Announcement channels show "Staff only" notice

## 📊 Database Check

To verify in postgres:

```sql
-- Check spaces exist
SELECT COUNT(*) as space_count FROM "Space";

-- Check channels exist
SELECT COUNT(*) as channel_count FROM "Channel";

-- Check specific branch
SELECT * FROM "Space" WHERE "branchId" = 'YOUR_BRANCH_ID';

-- Check student has branch + level
SELECT id, "branchId", level FROM "Student" WHERE "userId" = 'STUDENT_USER_ID';
```

## 🎯 What's Fixed

- ✅ "Unable to load community spaces" error gone
- ✅ Students can access their community space
- ✅ Staff can see all spaces
- ✅ Threads work (create, read, reply)
- ✅ Unread badges work (real-time updates)
- ✅ Comments nest properly (Reddit-style)
- ✅ Works online AND physical classes
- ✅ Push notifications for new posts
- ✅ Better error messages for debugging

## 📚 Documentation

- **Full Setup Guide**: `docs/COMMUNITY.md`
- **API Reference**: `docs/COMMUNITY.md` (endpoints section)
- **Architecture**: `docs/COMMUNITY.md` (overview section)
- **This Fix Summary**: `COMMUNITY_FIX.md`

## ⏱️ Time to Deploy

- 1 minute: Run 3 commands
- Instant: Students can use community
- No restart needed
- No data loss
- Safe to run multiple times

---

**Everything is ready. Just run the 3 commands above and you're done! 🎉**
