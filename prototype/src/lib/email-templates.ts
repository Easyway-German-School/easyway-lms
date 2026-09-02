/**
 * Email template utilities for different notification types
 */

interface EmailTemplate {
  subject: string;
  html: string;
}

export function welcomeEmailTemplate(studentName: string, pathwayName: string): EmailTemplate {
  const name = studentName || "there";
  return {
    subject: "Welcome to Easyway LMS! 🎉",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: #4CAF50; margin-bottom: 20px;">Welcome to Easyway LMS!</h1>
        
        <p>Hello ${name},</p>
        
        <p>Thank you for your payment! Your enrollment in <strong>${pathwayName}</strong> is now active.</p>
        
        <p>You can now access:</p>
        <ul style="line-height: 1.8;">
          <li>📚 All course materials and lessons</li>
          <li>🎥 Video tutorials and recordings</li>
          <li>📋 Practice quizzes and assignments</li>
          <li>👥 Live sessions with your tutor</li>
          <li>💬 Community discussions</li>
        </ul>
        
        <p style="margin-top: 20px;">
          <a href="https://easyway.test/student/dashboard" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Access Your Dashboard
          </a>
        </p>
        
        <p style="margin-top: 30px; font-size: 14px; color: #666;">
          If you have any questions, please don't hesitate to contact our support team.
        </p>
        
        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best regards,<br/>
          The Easyway LMS Team
        </p>
      </div>
    `,
  };
}

export function feeReminderEmailTemplate(
  studentName: string,
  /** Days since the invoice was raised (7 | 14 | 30), or "locked" once access has actually paused. */
  stage: number | "locked",
  amountDue: number,
  currency: string = "NGN",
  /** When portal access pauses (or paused). Named in the 30-day and locked emails. */
  lockDate?: Date | null,
): EmailTemplate {
  const name = studentName || "there";
  const money =
    currency === "NGN" || currency === "ngn"
      ? `₦${Math.round(amountDue).toLocaleString("en-NG")}`
      : `${Math.round(amountDue).toLocaleString("en-NG")} ${currency}`;
  const payUrl = `${(process.env.NEXTAUTH_URL || "").replace(/\/$/, "")}/payments`;
  const lockLabel = lockDate
    ? lockDate.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const isLocked = stage === "locked";
  const dayLabel = stage === 7 ? "one week" : stage === 14 ? "two weeks" : stage === 30 ? "one month" : "";

  const heading = isLocked ? "Your portal access is paused" : "Payment reminder";
  const lead = isLocked
    ? `Your tuition balance of <strong>${money}</strong> is still outstanding, so access to your classes, assignments and certificates is now paused.`
    : `This is a reminder that your tuition balance of <strong>${money}</strong> has been outstanding for ${dayLabel || "a while"}.`;
  const consequence = isLocked
    ? `As soon as the balance is settled — from the Payments page or with your branch office — your access is restored straight away.`
    : lockLabel
      ? `If it is not settled by <strong>${lockLabel}</strong>, access to your classes, assignments and certificates will pause until it is.`
      : `Please settle it to keep uninterrupted access to your classes.`;

  return {
    subject: isLocked
      ? `Access paused — ${money} tuition balance outstanding`
      : `⏰ Payment reminder: ${money} tuition balance due`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: #FF9800; margin-bottom: 20px;">${heading}</h1>

        <p>Hello ${name},</p>

        <p>${lead}</p>

        <p>${consequence}</p>

        ${
          payUrl
            ? `<p style="margin: 20px 0;">
          <a href="${payUrl}" style="background-color: #FF9800; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            ${isLocked ? "Settle my balance" : "Make a payment"}
          </a>
        </p>`
            : ""
        }

        <p style="background-color: #FFF3E0; border-left: 4px solid #FF9800; padding: 15px; margin: 20px 0;">
          You can pay any amount toward the balance — you do not have to clear it all at once.
        </p>

        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best regards,<br/>
          The EasyWay team
        </p>
      </div>
    `,
  };
}

export function examReminderEmailTemplate(
  studentName: string,
  examName: string,
  examDate: Date,
  tutorName?: string
): EmailTemplate {
  const name = studentName || "there";
  const formattedDate = new Date(examDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  
  return {
    subject: `📝 Exam reminder: ${examName} on ${formattedDate}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: #2196F3; margin-bottom: 20px;">Exam Reminder</h1>
        
        <p>Hello ${name},</p>
        
        <p>This is a reminder that your exam is coming up:</p>
        
        <div style="background-color: #E3F2FD; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Exam:</strong> ${examName}</p>
          <p style="margin: 5px 0;"><strong>Date:</strong> ${formattedDate}</p>
          ${tutorName ? `<p style="margin: 5px 0;"><strong>Your Tutor:</strong> ${tutorName}</p>` : ""}
        </div>
        
        <p>Make sure to:</p>
        <ul style="line-height: 1.8;">
          <li>✓ Review all study materials</li>
          <li>✓ Complete practice exercises</li>
          <li>✓ Get a good night's sleep before the exam</li>
          <li>✓ Arrive early on exam day</li>
        </ul>
        
        <p style="margin: 20px 0;">
          <a href="https://easyway.test/student/exams" style="background-color: #2196F3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Exam Details
          </a>
        </p>
        
        <p style="margin-top: 20px; font-size: 14px; color: #666;">
          Need help? Reach out to your tutor${tutorName ? ` (${tutorName})` : ""} before the exam.
        </p>
        
        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best of luck!<br/>
          The Easyway LMS Team
        </p>
      </div>
    `,
  };
}

export function graduationEmailTemplate(
  studentName: string,
  pathwayName: string,
  tutorName?: string,
  tutorEmail?: string
): EmailTemplate {
  const name = studentName || "there";
  
  return {
    subject: `🎓 Congratulations! You've completed ${pathwayName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: #4CAF50; margin-bottom: 20px;">🎓 Congratulations!</h1>
        
        <p>Hello ${name},</p>
        
        <p>We are proud to announce that you have successfully completed the <strong>${pathwayName}</strong> program!</p>
        
        <p>Your dedication and hard work have paid off. This is a significant milestone in your learning journey.</p>
        
        <div style="background-color: #E8F5E9; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Achievements:</strong></p>
          <ul style="margin: 10px 0; padding-left: 20px;">
            <li>✓ Completed all course modules</li>
            <li>✓ Passed all assessments</li>
            <li>✓ Earned your certificate</li>
          </ul>
        </div>
        
        <p style="margin: 20px 0;">
          <a href="https://easyway.test/student/certificate" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Download Your Certificate
          </a>
        </p>
        
        <p style="margin-top: 20px;">
          What's next? Consider advancing to the next level or exploring related programs to continue your growth.
        </p>
        
        <p style="margin-top: 20px; font-size: 14px; color: #666;">
          Thank you for choosing Easyway LMS. We look forward to supporting your continued learning journey!
        </p>
        
        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best regards,<br/>
          The Easyway LMS Team
        </p>
      </div>
    `,
  };
}

export function newMaterialNotificationTemplate(
  studentName: string,
  materialTitle: string,
  courseName: string,
  tutorName?: string
): EmailTemplate {
  const name = studentName || "there";
  
  return {
    subject: `📚 New material available: ${materialTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: #2196F3; margin-bottom: 20px;">📚 New Material Available</h1>
        
        <p>Hello ${name},</p>
        
        <p>Great news! New study material has been added to your course:</p>
        
        <div style="background-color: #E3F2FD; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Material:</strong> ${materialTitle}</p>
          <p style="margin: 5px 0;"><strong>Course:</strong> ${courseName}</p>
          ${tutorName ? `<p style="margin: 5px 0;"><strong>Posted by:</strong> ${tutorName}</p>` : ""}
        </div>
        
        <p style="margin: 20px 0;">
          <a href="https://easyway.test/student/courses" style="background-color: #2196F3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Material
          </a>
        </p>
        
        <p style="margin-top: 20px; font-size: 14px; color: #666;">
          Don't fall behind! Review this material at your earliest convenience.
        </p>
        
        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best regards,<br/>
          The Easyway LMS Team
        </p>
      </div>
    `,
  };
}

export function examResultsEmailTemplate(
  studentName: string,
  examName: string,
  score: number,
  grade: string,
  feedback?: string
): EmailTemplate {
  const name = studentName || "there";
  const gradeColor = ["A", "B"].includes(grade) ? "#4CAF50" : grade === "C" ? "#FF9800" : "#F44336";
  
  return {
    subject: `📊 Your exam results for ${examName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: ${gradeColor}; margin-bottom: 20px;">📊 Your Exam Results</h1>
        
        <p>Hello ${name},</p>
        
        <p>Your exam has been graded. Here are your results:</p>
        
        <div style="background-color: ${gradeColor}20; border-left: 4px solid ${gradeColor}; padding: 15px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Exam:</strong> ${examName}</p>
          <p style="margin: 5px 0;"><strong>Score:</strong> ${score}/100</p>
          <p style="margin: 5px 0;"><strong>Grade:</strong> <span style="font-size: 24px; font-weight: bold; color: ${gradeColor};">${grade}</span></p>
        </div>
        
        ${feedback ? `
          <p><strong>Feedback from your tutor:</strong></p>
          <p style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">${feedback}</p>
        ` : ""}
        
        <p style="margin: 20px 0;">
          <a href="https://easyway.test/student/grades" style="background-color: ${gradeColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Detailed Results
          </a>
        </p>
        
        <p style="margin-top: 20px; font-size: 14px; color: #666;">
          Congratulations on completing your exam! Review the feedback to identify areas for improvement.
        </p>
        
        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best regards,<br/>
          The Easyway LMS Team
        </p>
      </div>
    `,
  };
}

/**
 * The reset link.
 *
 * Deliberately the plainest mail this system sends. No banner image, no
 * marketing, nothing to click except the one button — because this is the
 * message a phisher most wants to imitate, and the more decorated the real one
 * is, the easier a fake one is to pass off. It also states the expiry and what
 * to do if the request was not theirs, which is the only useful thing we can
 * tell somebody whose account may be under attack.
 */
export function passwordResetEmailTemplate(name: string | null, link: string): EmailTemplate {
  const greeting = name?.trim() ? name.trim().split(/\s+/)[0] : "there";
  return {
    subject: "Reset your Easyway password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="font-size: 20px; margin-bottom: 20px;">Reset your password</h1>

        <p>Hello ${greeting},</p>

        <p>Somebody asked to reset the password on your Easyway account. If that was you, use the button below.</p>

        <p style="margin: 28px 0;">
          <a href="${link}" style="background-color: #1f6f4a; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Choose a new password
          </a>
        </p>

        <p style="font-size: 14px; color: #666;">
          This link works once and expires in one hour.
        </p>

        <p style="font-size: 14px; color: #666;">
          If you did not ask for this, you can ignore this email — your password
          will not change. If you keep receiving these, please reply and tell us.
        </p>

        <p style="margin-top: 24px; font-size: 12px; color: #999;">
          If the button does not work, paste this into your browser:<br/>
          <span style="word-break: break-all;">${link}</span>
        </p>

        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Easyway Language School
        </p>
      </div>
    `,
  };
}
