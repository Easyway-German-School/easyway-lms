import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { adminHasCapability } from "@/lib/admin-roles";
import { deleteFile, keyFromUrl } from "@/lib/storage";

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

    /**
     * The browser has already put the file in the bucket (see lib/upload.ts)
     * and sends only the metadata, because a request body through Vercel is
     * capped at 4.5 MB and course material routinely is not.
     */
    const body = await req.json().catch(() => ({}));
    const courseId = String(body.courseId ?? "").trim();
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    const fileUrl = String(body.fileUrl ?? "").trim();
    const fileName = String(body.fileName ?? "").trim();
    const fileType = String(body.fileType ?? "").trim();
    const fileSize = Number(body.fileSize) || 0;

    if (!fileUrl || !fileName || !courseId || !title) {
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

    // Create database record
    const material = await prisma.material.create({
      data: {
        courseId,
        title,
        description: description || null,
        filePath: fileUrl,
        fileName,
        fileType: fileType || fileName.split(".").pop() || "bin",
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

    // Reclaim the stored file. A failure here is logged and ignored: an
    // orphaned object costs pennies, a row that will not delete blocks the
    // admin who asked.
    const key = keyFromUrl(material.filePath);
    if (key) await deleteFile(key);

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
