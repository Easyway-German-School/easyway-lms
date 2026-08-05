# 📧 Notifications & Emails - Quick Start Guide

## What's Been Implemented

A complete **notifications and emails system** with automated reminders, email templates, and in-app notification center.

### ✅ 5 Email Types

1. **Welcome Email** 🎉 - After 100% payment completion
2. **Fee Reminders** ⏰ - At 7, 14, 30 days for partial payments
3. **Exam Reminders** 📝 - Before upcoming exams
4. **Graduation Emails** 🎓 - To student and tutor on completion
5. **In-App Notifications** 🔔 - Real-time updates (new materials, exam results)

## Quick Setup

### 1. Database Migration

Run Prisma migration to create the new tables:

```bash
cd prototype
npx prisma migrate dev --name add_emails_notifications
npx prisma db push
```

### 2. Configure Email (SMTP)

Add to `.env.local`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=EasyWay LMS <noreply@easyway.test>
```

### 3. Setup Cron Job for Reminders

Add a daily cron job to send fee reminders automatically.

**Option A: Using node-cron (local development)**
```typescript
// Add to your server startup
import cron from 'node-cron';

cron.schedule('0 8 * * *', async () => {
  await fetch(`${process.env.NEXTAUTH_URL}/api/cron/fee-reminders`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
  });
});
```

**Option B: Using GitHub Actions**
Create `.github/workflows/reminders.yml` with daily schedule trigger to call `/api/cron/fee-reminders`

**Option C: Using EasyCron or similar service**
Set up to call: `GET /api/cron/fee-reminders` with Authorization header

## File Structure

```
src/
├── lib/
│   ├── email-templates.ts          # All email templates
│   └── mailer.ts                   # SMTP configuration (existing)
├── app/
│   ├── api/
│   │   ├── emails/send/
│   │   │   ├── welcome/route.ts    # Welcome email endpoint
│   │   │   ├── exam-reminder/      # Exam reminders
│   │   │   ├── graduation/         # Graduation emails
│   │   │   └── fee-reminders/      # Fee reminder logic
│   │   ├── notifications/route.ts  # In-app notifications API
│   │   └── cron/
│   │       └── fee-reminders/      # Scheduled cron job
│   ├── admin/
│   │   └── emails/page.tsx         # Admin email management
│   └── student/
│       └── notifications/page.tsx  # Student notifications page
└── components/
    └── NotificationCenter.tsx       # Notification bell component

prisma/
├── schema.prisma                   # Updated with EmailLog, etc.
```

## Usage

### For Admins

1. **Send Manual Emails**
   - Go to `/admin/emails`
   - Select email type
   - Optionally specify student ID
   - Click "Send Email"

2. **View Email Statistics**
   - Go to `/admin/emails` → "Email Logs" tab
   - See count of each email type sent
   - View partial invoice count

3. **Configure Reminders**
   - Go to `/admin/emails` → "Settings" tab
   - Follow cron job setup instructions
   - Configure email preferences

### For Students

1. **View Notifications**
   - Click notification bell 🔔 in dashboard header
   - View dropdown with recent notifications
   - Click "View all notifications" for full page

2. **Manage Notifications**
   - Mark as read individually or all at once
   - Delete notifications
   - Notifications are filtered by read/unread status

3. **Automatic Emails**
   - Receive welcome email after paying
   - Get fee reminders at 7, 14, 30 days (if payment is partial)
   - Get exam reminders before tests
   - Get graduation email when completing program

## API Reference

### Send Welcome Email
```bash
curl -X POST http://localhost:3000/api/emails/send/welcome \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{"studentId": "student_id"}'
```

### Send Fee Reminders
```bash
curl -X POST http://localhost:3000/api/emails/send/fee-reminders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{"forceSend": false}'
```

### Get Student Notifications
```bash
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

### Mark Notifications as Read
```bash
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{"notificationIds": ["notif_id1", "notif_id2"]}'
```

## Integration Points

### Payment Webhook (Auto-Triggered)
When a student completes a 100% payment:
- ✅ Welcome email is automatically sent
- ✅ Email is logged in `EmailLog` table
- ✅ Payment marked with `welcomeEmailSentAt`

### Fee Reminders (Scheduled)
Daily cron job checks:
- ✅ All invoices with status "PARTIAL"
- ✅ Sends reminder if 7, 14, or 30 days have passed
- ✅ Tracks sent reminders in student's `feeRemindersScheduled`
- ✅ Logs all attempts in `EmailLog`

## Testing

### Test Email Sending
```bash
# Test welcome email
curl -X POST http://localhost:3000/api/emails/send/welcome \
  -H "Content-Type: application/json" \
  -d '{
    "studentId": "test_student_id",
    "pathwayName": "Test Program"
  }'
```

### Test Notifications
```bash
# Get all notifications
curl http://localhost:3000/api/notifications

# Mark notification as read
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "notificationIds": ["notification_id"],
    "markAllAsRead": false
  }'
```

## Common Tasks

### Send Exam Reminder to All Registered Students
```bash
curl -X POST http://localhost:3000/api/emails/send/exam-reminder \
  -H "Content-Type: application/json" \
  -d '{
    "examId": "exam_id",
    "sendToAll": false
  }'
```

### Send Graduation Email
```bash
curl -X POST http://localhost:3000/api/emails/send/graduation \
  -H "Content-Type: application/json" \
  -d '{
    "studentId": "student_id",
    "pathwayName": "German Language Mastery"
  }'
```

### View Fee Reminder Statistics
```bash
curl http://localhost:3000/api/emails/send/fee-reminders
```

## Database Queries

### Check Email Logs
```sql
-- View all sent emails
SELECT * FROM "EmailLog" ORDER BY sentAt DESC LIMIT 10;

-- Count emails by type
SELECT type, COUNT(*) as count FROM "EmailLog" GROUP BY type;

-- Find failed emails
SELECT * FROM "EmailLog" WHERE status = 'failed';
```

### Check Fee Reminders
```sql
-- View invoices with partial status
SELECT * FROM "Invoice" WHERE status = 'partial';

-- Check which reminders were sent to a student
SELECT feeRemindersScheduled FROM "Student" WHERE id = 'student_id';
```

## Troubleshooting

### Emails Not Sending?

1. **Check SMTP Configuration**
   - Verify `.env.local` has correct SMTP settings
   - Test with: `node -e "require('@/lib/mailer').sendEmail({to: 'test@example.com', subject: 'Test', html: 'Test'})"`

2. **Check Email Logs**
   - Query: `SELECT * FROM "EmailLog" WHERE status = 'failed';`
   - Review `errorMessage` field

3. **Verify Database Migration**
   - Check that `EmailLog` table exists
   - Run: `npx prisma db push`

### Cron Job Not Running?

1. **Test Manually**
   ```bash
   curl -X GET http://localhost:3000/api/cron/fee-reminders \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
   ```

2. **Verify Token**
   - Check `CRON_SECRET` is set in `.env.local`
   - Verify token in request header matches

3. **Check Logs**
   - Review API server logs for errors
   - Check HTTP response status

## Next Steps

- 📱 Add SMS notifications support
- 🔔 Add push notifications via Firebase
- ⚙️ Add email template editor UI
- 🎯 Add student notification preferences page
- 📊 Add email analytics dashboard
- 🌍 Add timezone-aware scheduling

## Documentation

Full documentation available at: `NOTIFICATIONS_EMAIL_DOCS.md`
