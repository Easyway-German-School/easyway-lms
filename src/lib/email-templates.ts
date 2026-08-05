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
  daysOverdue: number,
  amountDue: number,
  currency: string = "NGN"
): EmailTemplate {
  const name = studentName || "there";
  const dayLabel = daysOverdue === 7 ? "one week" : daysOverdue === 14 ? "two weeks" : "one month";
  
  return {
    subject: `⏰ Payment reminder: ${amountDue} ${currency} due for your program`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h1 style="color: #FF9800; margin-bottom: 20px;">Payment Reminder</h1>
        
        <p>Hello ${name},</p>
        
        <p>This is a friendly reminder that your outstanding balance of <strong>${amountDue} ${currency}</strong> is now due.</p>
        
        <p>To maintain uninterrupted access to your program, please complete your payment within the next few days.</p>
        
        <p style="margin: 20px 0;">
          <a href="https://easyway.test/student/payments" style="background-color: #FF9800; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Make Payment Now
          </a>
        </p>
        
        <p style="background-color: #FFF3E0; border-left: 4px solid #FF9800; padding: 15px; margin: 20px 0;">
          <strong>Why pay now?</strong> Avoid study interruptions and maintain your learning momentum!
        </p>
        
        <p style="margin-top: 20px; font-size: 14px; color: #666;">
          Questions? Contact our billing team at support@easyway.test
        </p>
        
        <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
          Best regards,<br/>
          The Easyway LMS Team
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
