# Notifications & Emails System Documentation

## Overview

The EasyWay LMS notification and email system provides comprehensive communication capabilities for students, tutors, and administrators. It includes:

- **Welcome emails** after successful payments
- **Fee reminder emails** at 7, 14, and 30 days for PARTIAL payments
- **Exam reminder emails** before upcoming exams
- **Graduation emails** to student and their tutor
- **In-app notifications** for new materials, exam results, and other events

## Architecture

### Database Models

#### `EmailLog`
Tracks all sent emails for audit, retry, and analytics purposes.

```typescript
- id: string (primary key)
- studentId: string (optional)
- recipientEmail: string
- type: string ("welcome", "fee_reminder_7d", "fee_reminder_14d", "fee_reminder_30d", "exam_reminder", "graduation")
- subject: string
- status: string ("sent", "failed", "bounced")
- sentAt: DateTime
- errorMessage: string (optional)
- retries: int
```

#### `Notification` (Enhanced)
Represents in-app notifications that can also be sent via email.

```typescript
- id: string
- title: string
- message: string
- channel: string ("email" or "in-app")
- studentId: string (optional)
- status: string ("pending", "sent", "failed")
- sentAt: DateTime (optional)
- readAt: DateTime (optional) // For in-app notifications
```

#### `Student` (Enhanced Fields)
```typescript
- graduationDate: DateTime (optional) // When student graduated
- feeRemindersScheduled: Json // Tracks {7d: bool, 14d: bool, 30d: bool}
- emailPreferences: Json // User preferences for notification types
```

#### `Payment` (Enhanced Fields)
```typescript
- welcomeEmailSentAt: DateTime (optional) // Tracks when welcome email was sent
```

## Email Types

### 1. Welcome Email
**Trigger:** Automatically sent after a 100% payment is completed  
**Recipients:** Student  
**Content:** Program enrollment confirmation, access instructions, and dashboard link  
**Template:** `welcomeEmailTemplate()` from `lib/email-templates.ts`

### 2. Fee Reminder Emails
**Trigger:** Automatically sent at 7, 14, and 30 days after invoice creation for PARTIAL status invoices  
**Recipients:** Student  
**Content:** Payment reminder with outstanding amount and payment link  
**Types:** 
- `fee_reminder_7d`
- `fee_reminder_14d` 
- `fee_reminder_30d`

### 3. Exam Reminder Email
**Trigger:** Manually triggered or via admin interface  
**Recipients:** Students with registered exams  
**Content:** Exam details, date/time, and study tips  
**Template:** `examReminderEmailTemplate()`

### 4. Graduation Email
**Trigger:** Manually triggered when student completes program  
**Recipients:** Student and their tutor (if assigned)  
**Content:** Graduation congratulations, certificate link, next steps  
**Template:** `graduationEmailTemplate()`

### 5. New Material Notification
**Trigger:** When new course materials are uploaded  
**Recipients:** Students in that course  
**Content:** Material title, course name, tutor name  
**Template:** `newMaterialNotificationTemplate()`

### 6. Exam Results Notification
**Trigger:** When exam grades are recorded  
**Recipients:** Student  
**Content:** Score, grade, and grading feedback  
**Template:** `examResultsEmailTemplate()`

## API Endpoints

### Send Emails

#### POST `/api/emails/send/welcome`
Send welcome email to a student after payment.

```bash
curl -X POST http://localhost:3000/api/emails/send/welcome \
  -H "Content-Type: application/json" \
  -d {
    "paymentId": "payment_123",
    "pathwayName": "German Language Mastery"
  }
```

**Response:**
```json
{
  "success": true,
  "message": "Welcome email sent"
}
```

#### POST `/api/emails/send/exam-reminder`
Send exam reminders to registered students.

```bash
curl -X POST http://localhost:3000/api/emails/send/exam-reminder \
  -H "Content-Type: application/json" \
  -d {
    "examId": "exam_123",
    "sendToAll": false
  }
```

**Query Parameters:**
- `examId`: Send to students registered for this exam
- `examRegistrationId`: Send to specific registration
- `sendToAll`: Send to all exams with dates in next N days (default 3)

#### POST `/api/emails/send/graduation`
Send graduation emails to student and tutor.

```bash
curl -X POST http://localhost:3000/api/emails/send/graduation \
  -H "Content-Type: application/json" \
  -d {
    "studentId": "student_123",
    "pathwayName": "German Language Mastery"
  }
```

#### POST `/api/emails/send/fee-reminders`
Send fee reminder emails to students with PARTIAL invoices.

```bash
curl -X POST http://localhost:3000/api/emails/send/fee-reminders \
  -H "Content-Type: application/json" \
  -d {
    "studentId": "student_123",
    "forceSend": false
  }
```

**Parameters:**
- `studentId`: (Optional) Send reminders only to this student
- `forceSend`: (Optional) Force sending even if already sent

**Response:**
```json
{
  "success": true,
  "message": "Fee reminders sent to 5 students",
  "sentCount": 5,
  "totalProcessed": 10
}
```

### In-App Notifications

#### GET `/api/notifications`
Fetch notifications for the logged-in student.

```bash
curl http://localhost:3000/api/notifications?unread=true&limit=20
```

**Query Parameters:**
- `unread`: Only return unread notifications (true/false)
- `limit`: Maximum number to return (default 20, max 100)

**Response:**
```json
{
  "notifications": [
    {
      "id": "notif_123",
      "title": "Exam Results",
      "message": "Your exam grade is ready",
      "channel": "in-app",
      "status": "sent",
      "readAt": null,
      "createdAt": "2026-07-21T10:00:00Z"
    }
  ],
  "unreadCount": 3
}
```

#### PATCH `/api/notifications`
Mark notifications as read.

```bash
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d {
    "notificationIds": ["notif_123", "notif_124"],
    "markAllAsRead": false
  }
```

**Parameters:**
- `notificationIds`: Array of notification IDs to mark as read
- `markAllAsRead`: Mark all unread notifications as read (true/false)

#### DELETE `/api/notifications`
Delete notifications.

```bash
curl -X DELETE http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d {
    "notificationIds": ["notif_123"]
  }
```

## Scheduled Tasks (Cron Jobs)

### Fee Reminder Cron Job

**Endpoint:** `GET /api/cron/fee-reminders`

**Purpose:** Automatically send fee reminders at 7, 14, and 30 days for students with PARTIAL payments.

**Setup Instructions:**

1. Add to your `.env.local`:
```
CRON_SECRET=your_secret_token_here
SYSTEM_API_KEY=your_system_api_key_here
```

2. Configure a cron service to call the endpoint daily:

**Using EasyCron (easycron.com):**
```
GET http://your-domain.com/api/cron/fee-reminders
HTTP Headers: Authorization: Bearer your_secret_token
```

**Using GitHub Actions:**
Create `.github/workflows/fee-reminders.yml`:
```yaml
name: Send Fee Reminders
on:
  schedule:
    - cron: '0 8 * * *'  # Daily at 8 AM UTC

jobs:
  send-reminders:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger fee reminders
        run: |
          curl -X GET "${{ secrets.APP_URL }}/api/cron/fee-reminders" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

**Using node-cron (if running locally):**
```typescript
import cron from 'node-cron';
import fetch from 'node-fetch';

// Run daily at 8 AM
cron.schedule('0 8 * * *', async () => {
  try {
    await fetch(`${process.env.NEXTAUTH_URL}/api/cron/fee-reminders`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
    });
  } catch (error) {
    console.error('Cron job failed:', error);
  }
});
```

## Admin Interface

### Email Management Dashboard
**URL:** `/admin/emails`

**Features:**
1. **Send Email Tab**
   - Select email type (Welcome, Exam Reminder, Graduation, Fee Reminders)
   - Specify target student (optional)
   - View sending status and results

2. **Email Logs Tab**
   - View statistics on sent emails
   - Track partial invoices
   - Monitor email delivery status

3. **Settings Tab**
   - Configure cron job setup instructions
   - View SMTP configuration requirements
   - Enable/disable notification types

## Configuration

### SMTP Setup

Add to `.env.local`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@easyway.test
```

### Email Preferences (Future)

Students can customize notification preferences in their profile settings:
```typescript
{
  "emailNotifications": true,
  "examReminders": true,
  "paymentReminders": true,
  "materialUpdates": true,
  "graduationNotifications": true,
  "feeReminderDays": [7, 14, 30]
}
```

## Client Components

### NotificationCenter Component
**Location:** `/src/components/NotificationCenter.tsx`

Displays a notification bell icon with unread count and dropdown panel.

**Usage in Layout:**
```typescript
import NotificationCenter from '@/components/NotificationCenter';

export default function StudentLayout() {
  return (
    <div className="flex items-center gap-4">
      <NotificationCenter />
      {/* other header items */}
    </div>
  );
}
```

### Notifications Page
**URL:** `/student/notifications`

Full-page view of all notifications with filtering and management options.

## Best Practices

### 1. Email Best Practices
- Always include a direct call-to-action button
- Use professional but friendly tone
- Include branding and contact information
- Test email templates in multiple clients
- Monitor bounce and unsubscribe rates

### 2. Timing
- Fee reminders: 7, 14, 30 days (configurable)
- Exam reminders: 3 days before (configurable)
- Welcome email: Immediately after payment confirmation
- Graduation email: When pathway completion is confirmed

### 3. Personalization
- Always address students by name
- Include relevant program/exam names
- Reference tutor names when applicable
- Use student's payment history context

### 4. Monitoring
- Check `EmailLog` table regularly for failed sends
- Monitor SMTP delivery rates
- Review admin email dashboard stats
- Test with demo accounts before changes

## Troubleshooting

### Emails Not Sending

1. **Check SMTP Configuration**
   - Verify SMTP credentials in `.env.local`
   - Test with test email endpoint
   - Check email provider's sending limits

2. **Check Email Logs**
   - Query `EmailLog` table for errors
   - Review `errorMessage` field for details
   - Check `retries` count

3. **Database Issues**
   - Verify `EmailLog` table exists (run migrations)
   - Check student email field is populated
   - Verify student exists in database

### Cron Job Not Running

1. **Verify Token**
   - Check `CRON_SECRET` matches in requests
   - Verify `Authorization` header format

2. **Check Logs**
   - View API request logs
   - Check for HTTP 401 or 403 responses
   - Verify endpoint is accessible

3. **Test Manually**
   - Call API directly with curl
   - Check response status and body
   - Verify database was updated

## Examples

### Programmatically Send Email

```typescript
import { sendEmail } from '@/lib/mailer';
import { welcomeEmailTemplate } from '@/lib/email-templates';

const template = welcomeEmailTemplate('John', 'German Mastery');

await sendEmail({
  to: 'john@example.com',
  subject: template.subject,
  html: template.html,
});
```

### Create In-App Notification

```typescript
import { prisma } from '@/lib/prisma';

await prisma.notification.create({
  data: {
    studentId: 'student_123',
    title: 'Exam Results Ready',
    message: 'Your exam grades have been posted',
    channel: 'in-app',
    status: 'sent',
  },
});
```

### Track Fee Reminders

```typescript
const student = await prisma.student.findUnique({
  where: { id: 'student_123' },
});

const reminders = student.feeRemindersScheduled as Record<string, boolean>;
console.log('7d reminder sent:', reminders['7d']);
```

## Future Enhancements

- [ ] SMS notifications
- [ ] Push notifications
- [ ] Email template editor UI
- [ ] Student notification preferences
- [ ] Email A/B testing
- [ ] Advanced scheduling (timezone-aware)
- [ ] Batch email processing
- [ ] Email bounce handling
- [ ] Unsubscribe management
- [ ] Email frequency capping
