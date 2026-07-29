import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { adminHasCapability } from "@/lib/admin-roles";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "materials");
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get("courseId");

    const where = courseId ? { courseId } : {};

    const materials = await prisma.material.findMany({
      where,
      include: {
        course: {
          select: { title: true }
        }
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(materials);
  } catch (error) {
    console.error("Error fetching materials:", error);
    return NextResponse.json(
      { error: "Failed to fetch materials" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const courseId = formData.get("courseId") as string;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;

    if (!file || !courseId || !title) {
      return NextResponse.json(
        { error: "file, courseId, and title are required" },
        { status: 400 }
      );
    }

    // Check if course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      return NextResponse.json(
        { error: "Course not found" },
        { status: 404 }
      );
    }

    // Get file extension
    const fileExtension = file.name.split(".").pop() || "bin";
    const fileName = `${Date.now()}-${file.name}`;
    const uploadDir = join(process.cwd(), "public", "materials");

    // Ensure directory exists
    if (!existsSync(uploadDir)) {
      const fs = await import("fs/promises");
      await fs.mkdir(uploadDir, { recursive: true });
    }

    // Save file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filePath = join(uploadDir, fileName);
    
    await writeFile(filePath, buffer);

    const fileUrl = `/materials/${fileName}`;
    const fileSize = buffer.length;

    // Create database record
    const material = await prisma.material.create({
      data: {
        courseId,
        title,
        description: description || null,
        filePath: fileUrl,
        fileName,
        fileType: fileExtension,
        fileSize,
        uploadedBy: session.user.id,
      },
      include: {
        course: {
          select: { title: true }
        }
      }
    });

    return NextResponse.json(material);
  } catch (error) {
    console.error("Error uploading material:", error);
    return NextResponse.json(
      { error: "Failed to upload material" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!await isAdmin(session.user.id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const material = await prisma.material.findUnique({
      where: { id },
    });

    if (!material) {
      return NextResponse.json(
        { error: "Material not found" },
        { status: 404 }
      );
    }

    // Delete file from filesystem
    try {
      const filePath = join(process.cwd(), "public", material.filePath.replace(/^\//, ""));
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch (err) {
      console.error("Error deleting file:", err);
    }

    // Delete database record
    await prisma.material.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting material:", error);
    return NextResponse.json(
      { error: "Failed to delete material" },
      { status: 500 }
    );
  }
}
