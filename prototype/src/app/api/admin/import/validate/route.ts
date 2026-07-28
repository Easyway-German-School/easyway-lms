import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, csv_text } = body;

    if (!mode || !csv_text) {
      return NextResponse.json({ error: "mode and csv_text required" }, { status: 400 });
    }

    const rows = csv_text
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => line.split(",").map((v: string) => v.trim()));

    if (rows.length < 2) {
      return NextResponse.json({ error: "CSV needs a header row and at least one data row" }, { status: 400 });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const errors: Record<number, string[]> = {};
    const validRows: Record<string, string>[] = [];

    if (mode === "students") {
      const nameIdx = headers.findIndex((h: string) => h.toLowerCase() === "name" || h.toLowerCase() === "full_name");
      const emailIdx = headers.findIndex((h: string) => h.toLowerCase() === "email");
      const levelIdx = headers.findIndex((h: string) => h.toLowerCase() === "level");

      if (nameIdx === -1 || emailIdx === -1) {
        return NextResponse.json({ error: "CSV must have 'name' and 'email' columns" }, { status: 400 });
      }

      dataRows.forEach((row: any[], idx: number) => {
        const rowErrors: string[] = [];
        const name = row[nameIdx]?.trim();
        const email = row[emailIdx]?.trim().toLowerCase();
        const level = row[levelIdx]?.trim() || "A1";

        if (!name) rowErrors.push("Name is required");
        if (!email || !email.includes("@")) rowErrors.push("Valid email is required");
        if (!/^[A-C][1-2]$/i.test(level)) rowErrors.push(`Level must be A1-C2, got: ${level}`);

        if (rowErrors.length === 0) {
          validRows.push({ name, email, level, pathway: row[3] || "Lecturer Uploaded Courses" });
        } else {
          errors[idx] = rowErrors;
        }
      });
    }

    if (mode === "courses") {
      const courseIdx = headers.findIndex((h: string) => /course.*(title|name)/i.test(h));
      const moduleIdx = headers.findIndex((h: string) => /module.*(title|name)/i.test(h));
      const lessonIdx = headers.findIndex((h: string) => /lesson.*(title|name)/i.test(h));

      if (courseIdx === -1 || lessonIdx === -1) {
        return NextResponse.json({ error: "CSV must have 'course_title' and 'lesson_title' columns" }, { status: 400 });
      }

      dataRows.forEach((row: any[], idx: number) => {
        const rowErrors: string[] = [];
        const courseTitle = row[courseIdx]?.trim();
        const lessonTitle = row[lessonIdx]?.trim();

        if (!courseTitle) rowErrors.push("Course title is required");
        if (!lessonTitle) rowErrors.push("Lesson title is required");

        if (rowErrors.length === 0) {
          const moduleTitle = row[moduleIdx]?.trim() || "Module 1";
          validRows.push({
            course_title: courseTitle,
            module_title: moduleTitle,
            lesson_title: lessonTitle,
            lesson_content: row[4] || "",
            duration: row[5] || "20",
          });
        } else {
          errors[idx] = rowErrors;
        }
      });
    }

    const hasErrors = Object.keys(errors).length > 0;
    return NextResponse.json({
      validRows,
      errors: hasErrors ? errors : null,
      validCount: validRows.length,
      errorCount: Object.keys(errors).length,
    });
  } catch (error) {
    console.error("Validation error:", error);
    return NextResponse.json({ error: "Failed to validate CSV" }, { status: 500 });
  }
}
