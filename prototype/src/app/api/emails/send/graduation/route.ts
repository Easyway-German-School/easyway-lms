import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { graduationEmailTemplate } from "@/lib/email-templates";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/emails/send/graduation
 * Send graduation emails to student and their tutor
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { studentId, pathwayName } = body;

    if (!studentId || !pathwayName) {
      return NextResponse.json({ error: "studentId and pathwayName required" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        tutor: { include: { user: true } },
      },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const studentEmail = student.user?.email;
    const studentName = student.user?.name;
    const tutorName = student.tutor?.user?.name;
    const tutorEmail = student.tutor?.user?.email;

    if (!studentEmail) {
      return NextResponse.json({ error: "Student email not found" }, { status: 400 });
    }

    let sentCount = 0;
    const errors: string[] = [];

    try {
      // Send to student
      const studentTemplate = graduationEmailTemplate(studentName || "Student", pathwayName, tutorName || undefined, tutorEmail);
      
      await sendEmail({
        to: studentEmail,
        subject: studentTemplate.subject,
        html: studentTemplate.html,
      });

      await prisma.emailLog.create({
        data: {
          studentId: student.id,
          recipientEmail: studentEmail,
          type: "graduation",
          subject: studentTemplate.subject,
          status: "sent",
        },
      });

      sentCount++;

      // Send to tutor if exists
      if (tutorEmail) {
        try {
          const tutorTemplate = {
            subject: `🎓 Congratulations! Your student ${studentName} has graduated from ${pathwayName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                <h1 style="color: #4CAF50; margin-bottom: 20px;">🎓 Student Graduation</h1>
                
                <p>Hello ${tutorName},</p>
                
                <p>We are pleased to inform you that your student <strong>${studentName}</strong> has successfully completed the <strong>${pathwayName}</strong> program!</p>
                
                <p>Your dedication and guidance have contributed significantly to their success. Thank you for being an excellent mentor.</p>
                
                <div style="background-color: #E8F5E9; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>Student:</strong> ${studentName}</p>
                  <p style="margin: 5px 0;"><strong>Program:</strong> ${pathwayName}</p>
                  <p style="margin: 5px 0;"><strong>Status:</strong> Graduation Complete ✓</p>
                </div>
                
                <p style="margin-top: 20px; font-size: 14px; color: #666;">
                  Congratulations on this achievement! Consider reaching out to ${studentName} to discuss their next learning goals.
                </p>
                
                <p style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 12px; color: #999;">
                  Best regards,<br/>
                  The EasyWay LMS Team
                </p>
              </div>
            `,
          };

          await sendEmail({
            to: tutorEmail,
            subject: tutorTemplate.subject,
            html: tutorTemplate.html,
          });

          await prisma.emailLog.create({
            data: {
              studentId: student.id,
              recipientEmail: tutorEmail,
              type: "graduation",
              subject: tutorTemplate.subject,
              status: "sent",
            },
          });

          sentCount++;
        } catch (error) {
          errors.push(`Failed to send graduation email to tutor: ${error}`);
        }
      }

      // Mark graduation date
      if (!student.graduationDate) {
        await prisma.student.update({
          where: { id: student.id },
          data: { graduationDate: new Date() },
        });
      }

      return NextResponse.json({
        success: true,
        message: `Graduation emails sent to ${sentCount} recipients`,
        sentCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error sending graduation email:", error);
      errors.push(`Failed to send graduation email: ${error}`);
      return NextResponse.json(
        {
          success: false,
          message: "Failed to send graduation emails",
          errors,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error in graduation email handler:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
