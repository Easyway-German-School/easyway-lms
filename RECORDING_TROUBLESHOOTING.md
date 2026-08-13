# Why Live Class Recordings Aren't Being Saved

## The Real Problem

Recordings are **being skipped completely** because your Vercel environment variables are incomplete or missing. The system has a "graceful degradation" design — if recording isn't configured, it doesn't crash the classroom, it just silently doesn't record.

**No error. No warning. No recording.**

---

## How It Should Work (The Chain)

```
1. Tutor opens classroom
   ↓
2. /api/live/session → ensureRecordingStarted()
   ↓
3. recordingStorage() checks if S3 credentials exist
   ↓
4a. IF YES → Start LiveKit egress to S3 bucket
4b. IF NO → Return null, recording skipped, tutor sees no error
   ↓
5. Class happens (recorded OR not)
   ↓
6. LiveKit finishes encoding
   ↓
7. Webhook sent → finaliseRecording() creates Material row
   ↓
8. Material appears in Video Library on Watch shelf
```

**If Step 3 returns null, everything after it is cancelled.**

---

## The Missing Piece: S3 Configuration

The code requires **EITHER**:
- `STORAGE_S3_*` variables (for uploads — recordings fall back to this)
- `RECORDING_S3_*` variables (dedicated bucket — recommended)

### Required Variables

```
RECORDING_S3_BUCKET          The bucket name (e.g., "easyway-recordings")
RECORDING_S3_ACCESS_KEY      AWS/R2 access key
RECORDING_S3_SECRET          AWS/R2 secret key
RECORDING_S3_REGION          Region or "auto" (for Cloudflare R2)
RECORDING_S3_ENDPOINT        Endpoint URL (e.g., https://xxx.r2.cloudflarestorage.com)
```

### Optional But Recommended

```
RECORDING_PUBLIC_BASE_URL    CDN URL for playback (e.g., https://cdn.example.com)
RECORDING_VARIANT            "video" or "audio" (defaults to "video")
```

**If ANY of the first 5 are missing, recording is disabled.**

---

## How to Check if Recording is Configured

### Option 1: Check Your Environment (Vercel Dashboard)

1. Go to your Vercel project
2. Settings → Environment Variables
3. Search for `RECORDING_S3_BUCKET`
4. **If it doesn't exist, recording is OFF**

### Option 2: Check the Logs

During a live class:
- Student joins → class starts
- Check Vercel function logs

**With recording enabled, you should see:**
```
ensureRecordingStarted() → started egress ID: xyz123
```

**Without it, you'll see:**
```
recordingStorage() returns null
ensureRecordingStarted() returns null (silently)
```

### Option 3: Run the Diagnostic

```bash
node scripts/check-recording-config.js
```

(If this file doesn't exist, create it with the code below.)

---

## Step-by-Step Fix

### 1. Create an S3 Bucket (Cloudflare R2 recommended)

**Why R2?** Zero egress charges for recordings students download.

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Go to **R2 Object Storage**
3. Create a bucket: `easyway-recordings`
4. Note your **Account ID** from the R2 URL
5. Create an **API Token** with read/write access

### 2. Set Environment Variables on Vercel

Go to Vercel Dashboard → Your Project → Settings → Environment Variables

Add these (adjust for your provider):

**For Cloudflare R2:**
```
RECORDING_S3_BUCKET=easyway-recordings
RECORDING_S3_REGION=auto
RECORDING_S3_ENDPOINT=https://[your-account-id].r2.cloudflarestorage.com
RECORDING_S3_ACCESS_KEY=[token-access-key]
RECORDING_S3_SECRET=[token-secret]
RECORDING_PUBLIC_BASE_URL=https://recordings.yourdomain.com
```

**For AWS S3:**
```
RECORDING_S3_BUCKET=easyway-recordings
RECORDING_S3_REGION=eu-central-1
RECORDING_S3_ACCESS_KEY=[aws-key]
RECORDING_S3_SECRET=[aws-secret]
RECORDING_PUBLIC_BASE_URL=https://easyway-recordings.s3.eu-central-1.amazonaws.com
```

**For Backblaze B2:**
```
RECORDING_S3_BUCKET=easyway-recordings
RECORDING_S3_REGION=us-west-001
RECORDING_S3_ENDPOINT=https://s3.[region].backblazeb2.com
RECORDING_S3_ACCESS_KEY=[b2-app-key]
RECORDING_S3_SECRET=[b2-app-secret]
RECORDING_PUBLIC_BASE_URL=https://[bucket-name].s3.[region].backblazeb2.com
```

### 3. Redeploy

```bash
vercel redeploy
```

Or push to main branch if you have auto-deploy enabled.

### 4. Test

1. Join a live class as a tutor
2. Start teaching
3. Check Vercel logs for: `ensureRecordingStarted() → started egress`
4. End the class
5. Wait 1-2 minutes for encoding
6. Check Video Library → Watch → Should see the recording

---

## Debugging: Why Isn't It Still Working?

### Symptom 1: "No recordings appear in Video Library"

**Checklist:**
1. Are `RECORDING_S3_*` variables set on Vercel? ✓
2. Can you see the recording in your S3 bucket? ✓
3. Does the file exist at the right path?
   - Expected: `recordings/<branch>/<level>/<date>/<room>.mp4`
4. Check the database:
   ```sql
   SELECT * FROM classRecording 
   WHERE roomName = 'your-room-name' 
   ORDER BY createdAt DESC;
   ```
   - Is there a row with `status: 'active'`?
   - Does it have a `materialId`?

**If materialId is NULL:**
- The webhook never arrived (webhook is optional)
- Run reconciliation manually:
  ```bash
  curl -X POST https://yourdomain.com/api/live/recording/reconcile \
    -H "Authorization: Bearer $CRON_SECRET"
  ```

### Symptom 2: "File uploads to S3 but Material row isn't created"

The webhook might not be reaching you (development, firewall, deploy timing).

**Force reconciliation:**
```bash
# Via curl
curl -X POST https://yourdomain.com/api/live/recording/reconcile \
  -H "Authorization: Bearer $CRON_SECRET"

# Via browser
https://yourdomain.com/api/live/recording/reconcile?Bearer=$CRON_SECRET
```

**Schedule it to run:**
Set up a Vercel Cron to call `/api/live/recording/reconcile` every 5 minutes.
In `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/tick",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/live/recording/reconcile",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### Symptom 3: "Vercel logs show errors about S3"

```
Error: InvalidAccessKeyId: The AWS Access Key Id you provided does not exist
```

**Fix:** Your access key or secret is wrong. Double-check on the provider:
- R2: Verify token hasn't expired
- S3: Check IAM permissions
- B2: Verify app key is active

---

## The Code That Does This (For Understanding)

### Recording Check (src/lib/recording.ts)
```typescript
export function recordingStorage(): RecordingStorage | null {
  const bucket = process.env.RECORDING_S3_BUCKET || process.env.STORAGE_S3_BUCKET;
  const accessKey = process.env.RECORDING_S3_ACCESS_KEY || process.env.STORAGE_S3_ACCESS_KEY;
  const secret = process.env.RECORDING_S3_SECRET || process.env.STORAGE_S3_SECRET;
  
  // If ANY of these are missing, return null → recording disabled
  if (!bucket || !accessKey || !secret) return null;
  
  return {
    bucket,
    region: process.env.RECORDING_S3_REGION || "auto",
    endpoint: process.env.RECORDING_S3_ENDPOINT,
    accessKey,
    secret,
    publicBaseUrl: process.env.RECORDING_PUBLIC_BASE_URL,
  };
}

export function recordingConfigured(): boolean {
  return recordingStorage() !== null;
}
```

### Recording Start (src/lib/class-recorder.ts)
```typescript
export async function ensureRecordingStarted(input): Promise<string | null> {
  const storage = recordingStorage();  // ← Returns null if env vars missing
  const client = egressClient();
  
  if (!storage || !client) return null;  // ← EXITS HERE if storage is null
  
  // Everything below never runs if storage is null
  const info = await client.startRoomCompositeEgress(...);
  // ... creates database row, etc
  return info.egressId;
}
```

---

## What to Tell Support

**If you're asking someone for help:**

> "The live class recording isn't saving to the Video Library. I've checked DEPLOY.md and set the S3 bucket variables on Vercel, but recordings still don't appear. Here's what I have:
> - Bucket: `[name]`
> - Region: `[region]`
> - Endpoint: `[endpoint]`
> - The file DOES appear in S3, but never becomes a Material in the database."

This tells them:
1. You've done the setup
2. S3 is working
3. The problem is between "file exists in S3" and "Material row created"

---

## Summary

| If... | Then... |
|-------|---------|
| `RECORDING_S3_*` are set | Recording starts automatically, files upload to S3 ✅ |
| `RECORDING_S3_*` are missing | Recording is skipped silently, no error, nothing in Video Library ❌ |
| File in S3 but no Material row | Webhook didn't arrive; run `/api/live/recording/reconcile` ❌ |
| Material row exists but students can't play | `RECORDING_PUBLIC_BASE_URL` is wrong or missing 🎥 |

