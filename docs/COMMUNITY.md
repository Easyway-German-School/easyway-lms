# Community Feature Setup Guide

## Overview

The community feature provides a WhatsApp-like experience for students to discuss lessons, ask questions, and collaborate. Each branch + level combination gets its own community space with dedicated channels.

## Architecture

- **Spaces**: One per branch + level combination (e.g., "Abuja A1", "Lagos B2")
- **Channels**: Each space has 5 default channels (General, Grammar Help, Vocabulary, Announcements, Assignment Support)
- **Threads**: Discussion threads in each channel, with nested comments
- **Unread Badges**: Real-time tracking of unread messages per student

## Database Setup

### 1. Create the Database Tables
```bash
npm --prefix prototype run db:migrate
```

This creates all required tables:
- `Space` - Community spaces scoped to branch + level
- `Channel` - Discussion channels within spaces
- `Thread` - Conversation threads in channels
- `Comment` - Nested comments/replies on threads
- `ChannelRead` - Tracks per-user read markers for unread badges

### 2. Seed Community Spaces
After students and branches exist in your database:

```bash
npm --prefix prototype run seed:spaces
```

This creates a community space for each unique combination of:
- **Branches** (from your Branch table)
- **Student Levels** (from your Student table)

It also creates 5 default channels in each space:
1. **General** - General discussion and announcements
2. **Grammar Help** - Ask and answer grammar questions
3. **Vocabulary** - Share and discuss new words
4. **Announcements** - Updates from staff (staff-only posts)
5. **Assignment Support** - Help with assignments

## Frontend Implementation

### Student Portal
- **Floating Launcher** (`CommunityLauncher.tsx`): 
  - Smiley button in bottom-right
  - Shows unread badge count
  - Polls `/api/community/unread` every 60 seconds
  - Re-checks on window focus

- **Full View** (`/community`):
  - Channel sidebar with unread counts
  - Thread list with pinned indicators
  - Thread detail view with nested comments
  - New thread composer
  - Reply interface for comments

### Key Features
- ✅ Authorization: Students only see their branch's space
- ✅ Staff see all spaces
- ✅ Unread tracking per channel
- ✅ Real-time badge updates
- ✅ Push notifications for new threads/replies
- ✅ Comment nesting (Reddit-style)
- ✅ Role badges (Tutor/Staff) on messages

## API Endpoints

### GET `/api/community/spaces`
- **Purpose**: Get all spaces + channels the user can access, with unread counts
- **Auth**: Requires session
- **Response**: `{ spaces: [...], isStaff, unreadTotal, scope }`
- **Error**: 401 Unauthorized, 500 if spaces fail to load

### GET `/api/community/unread`
- **Purpose**: Get total unread count (for floating launcher badge)
- **Auth**: Requires session  
- **Response**: `{ total: number }`
- **Error**: 500, but falls back gracefully

### GET `/api/community/threads?channelId=...`
- **Purpose**: List threads in a channel
- **Auth**: Requires session + channel access
- **Response**: `{ channel, threads: [...] }`
- **Error**: 400 Bad Request (missing channelId), 403 Forbidden (no access), 500

### POST `/api/community/threads`
- **Purpose**: Create a new thread
- **Auth**: Requires session + channel write access
- **Body**: `{ channelId, title, body }`
- **Response**: `{ thread }` with 201 Created
- **Error**: 400 (validation), 403 (no access), 500
- **Note**: Sends push notifications to space members (async, not awaited)

### GET `/api/community/threads/[id]`
- **Purpose**: Get thread detail with nested comments
- **Auth**: Requires session + thread access
- **Response**: `{ thread, comments: [], commentCount }`
- **Error**: 403 Forbidden (no access), 500

### POST `/api/community/comments`
- **Purpose**: Reply to a thread or comment
- **Auth**: Requires session + thread write access
- **Body**: `{ threadId, body, parentId? }`
- **Response**: `{ comment }` with 201 Created
- **Error**: 400 (validation), 403 (no access), 500
- **Note**: Sends push notifications to thread participants only

### POST `/api/community/read`
- **Purpose**: Mark a channel as read
- **Auth**: Requires session + channel access
- **Body**: `{ channelId }`
- **Response**: `{ ok: true, lastReadAt }`
- **Error**: 403 Forbidden, 500

## Troubleshooting

### "Unable to load community spaces" Error

**Checklist:**
1. ✅ Database migrations ran: `npm run db:migrate`
2. ✅ Community spaces seeded: `npm run seed:spaces`
3. ✅ Student has `branchId` and `level` set
4. ✅ A Space exists for that branch + level combo
5. ✅ Check server logs for detailed error (development mode shows `details` field)

**Debug Steps:**
```bash
# Check if spaces exist:
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Space\";"

# Check if student has branch/level:
psql $DATABASE_URL -c "SELECT id, branchId, level FROM \"Student\" LIMIT 5;"

# Check if space exists for branch+level:
psql $DATABASE_URL -c "SELECT * FROM \"Space\" WHERE \"branchId\" = '...' AND \"level\" = '...';"
```

### No Channels in Space
After seeding, check:
```bash
psql $DATABASE_URL -c "SELECT * FROM \"Channel\" LIMIT 5;"
```

If empty, run the seed script again - it creates channels automatically.

### Unread Badge Not Updating
1. Check browser console for fetch errors
2. Verify `ChannelRead` table exists
3. Check that `lastReadAt` is being updated when viewing channels
4. Refresh browser (polling is every 60s)

### Staff Can't See All Spaces
Verify user's role field:
```bash
psql $DATABASE_URL -c "SELECT \"id\", \"name\", \"role\" FROM \"User\" WHERE role IN ('admin', 'lecturer');"
```

Role must be exactly "admin" or "lecturer" (case-insensitive).

## Online & Physical Tracking

The community feature works across:
- **Online Classes**: Students join at scheduled times, community stays open
- **Physical Classes**: Students at same branch + level see same space, can post from anywhere

Both are reflected in real-time.

## Performance Considerations

- **Unread queries**: Two queries per poll (markers + threads), cached client-side
- **Space load**: Single query per user, includes all channels + thread counts
- **Comment nesting**: Done in-memory after fetching, handles large reply trees
- **Push notifications**: Async (not awaited), won't block API responses

## Security

- ✅ Authorization on every endpoint (students can't see other branches)
- ✅ Staff isolation (staff can see all, students see only theirs)
- ✅ Parent comment validation (can't graft replies across threads)
- ✅ Read markers are per-user, per-channel
- ✅ No public access to community data (all requires session)

## Files Reference

**Database**
- `prisma/schema.prisma` - Space, Channel, Thread, Comment, ChannelRead models

**Seed Script**
- `scripts/seed-community-spaces.ts` - Creates spaces + channels

**API Routes**
- `src/app/api/community/spaces/route.ts` - GET spaces with unread
- `src/app/api/community/threads/route.ts` - GET/POST threads
- `src/app/api/community/threads/[id]/route.ts` - GET thread detail
- `src/app/api/community/comments/route.ts` - POST comments
- `src/app/api/community/read/route.ts` - POST mark read
- `src/app/api/community/unread/route.ts` - GET unread count

**Components**
- `src/components/CommunityHub.tsx` - Main UI (full page + launcher)
- `src/components/CommunityLauncher.tsx` - Floating launcher wrapper

**Libraries**
- `src/lib/community-spaces.ts` - Authorization + visibility rules
- `src/lib/community-unread.ts` - Unread tracking logic
- `src/lib/push.ts` - Push notification helpers
